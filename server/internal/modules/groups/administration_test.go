package groups

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestAdminHandoffIsDeterministicAndAchievementsNeedEvidence(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	svc := NewService(repo)

	alice := createTestUser(t, pool, "alice_admin_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_admin_"+uuid.NewString()[:8])
	carol := createTestUser(t, pool, "carol_admin_"+uuid.NewString()[:8])
	g, err := svc.Create(ctx, alice, CreateGroupRequest{Title: "handoff", MemberIDs: []uuid.UUID{bob, carol}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := pool.Exec(ctx, `INSERT INTO messages (chat_id, sender_id, content, message_type) VALUES ($1, $2, 'activity', 'text')`, g.ID, bob); err != nil {
			t.Fatalf("insert activity: %v", err)
		}
	}

	// Alice is the only admin. Bob wins the deterministic tie by joined_at,
	// then UUID if the timestamps happen to be equal.
	if _, err := svc.RemoveMember(ctx, g.ID, alice, alice); err != nil {
		t.Fatalf("self-leave with handoff: %v", err)
	}
	if role, err := repo.MemberRole(ctx, g.ID, bob); err != nil || role != RoleAdmin {
		t.Fatalf("bob role = %q, err=%v; want admin", role, err)
	}
	if _, err := repo.MemberRole(ctx, g.ID, alice); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("alice membership err = %v, want no rows", err)
	}

	var handoffs int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM messages WHERE chat_id = $1 AND content = $2`, g.ID, "group:admin_handoff:"+alice.String()+":"+bob.String()).Scan(&handoffs); err != nil {
		t.Fatalf("handoff event query: %v", err)
	}
	if handoffs != 1 {
		t.Fatalf("handoff events = %d, want 1", handoffs)
	}

	var evidence int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO messages (chat_id, sender_id, content, message_type)
		VALUES ($1, $2, 'evidence', 'text') RETURNING id
	`, g.ID, bob).Scan(&evidence); err != nil {
		t.Fatalf("insert evidence: %v", err)
	}
	criteria, _ := json.Marshal(map[string]any{"messages": 1})
	achievement, err := svc.CreateAchievement(ctx, g.ID, bob, CreateAchievementRequest{
		Icon: "★", Name: "First proof", Criteria: criteria,
	})
	if err != nil {
		t.Fatalf("CreateAchievement: %v", err)
	}
	if err := svc.AwardAchievement(ctx, g.ID, bob, achievement.ID, AwardAchievementRequest{UserID: carol, EvidenceMessageID: evidence}); err != nil {
		t.Fatalf("AwardAchievement: %v", err)
	}
	if err := svc.AwardAchievement(ctx, g.ID, bob, achievement.ID, AwardAchievementRequest{UserID: carol, EvidenceMessageID: evidence}); !errors.Is(err, ErrAchievementAlreadyAwarded) {
		t.Fatalf("duplicate award = %v, want ErrAchievementAlreadyAwarded", err)
	}
	if err := svc.AwardAchievement(ctx, g.ID, bob, achievement.ID, AwardAchievementRequest{UserID: carol, EvidenceMessageID: 999999999}); !errors.Is(err, ErrInvalidAchievementEvidence) {
		t.Fatalf("fake evidence = %v, want ErrInvalidAchievementEvidence", err)
	}
	list, err := svc.ListAchievements(ctx, g.ID, carol)
	if err != nil || len(list) != 1 || len(list[0].Awards) != 1 {
		t.Fatalf("achievement history = %+v, err=%v; want one award", list, err)
	}
}

func TestGroupPermissionsApplyToRoleAndTemporaryReadOnlyWindow(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))
	alice := createTestUser(t, pool, "alice_policy_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_policy_"+uuid.NewString()[:8])
	g, err := svc.Create(ctx, alice, CreateGroupRequest{Title: "policy", MemberIDs: []uuid.UUID{bob}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	future := time.Now().Add(time.Hour)
	if _, err := svc.Patch(ctx, g.ID, alice, PatchGroupRequest{Permissions: &GroupPermissions{
		Text: PermissionAdmin, Stickers: PermissionModerator, Audio: PermissionMember,
		Media: PermissionModerator, Posting: PermissionModerator, PostingUntil: &future,
	}}); err != nil {
		t.Fatalf("Patch permissions: %v", err)
	}
	if allowed, err := svc.CanSend(ctx, g.ID, bob, "text"); err != nil || allowed {
		t.Fatalf("member text allowed=%v err=%v; want denied", allowed, err)
	}
	if allowed, err := svc.CanSend(ctx, g.ID, alice, "text"); err != nil || !allowed {
		t.Fatalf("admin text allowed=%v err=%v; want allowed", allowed, err)
	}
	if _, err := svc.Patch(ctx, g.ID, alice, PatchGroupRequest{Permissions: &GroupPermissions{
		Text: PermissionAdmin, Stickers: PermissionModerator, Audio: PermissionMember,
		Media: PermissionModerator, Posting: PermissionMember,
	}}); err != nil {
		t.Fatalf("disable temporary window: %v", err)
	}
	if allowed, err := svc.CanSend(ctx, g.ID, bob, "audio"); err != nil || !allowed {
		t.Fatalf("member audio allowed=%v err=%v; want allowed", allowed, err)
	}
}

func TestAdminMutationRechecksRoleAfterConcurrentDemotion(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	svc := NewService(repo)
	alice := createTestUser(t, pool, "alice_race_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_race_"+uuid.NewString()[:8])
	group, err := svc.Create(ctx, alice, CreateGroupRequest{Title: "race", MemberIDs: []uuid.UUID{bob}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Hold the same group-row lock used by mutation authorization while
	// demoting Alice. The repository call starts with a stale, externally
	// observed admin decision but must re-check after the demotion commits.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin demotion: %v", err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM chats WHERE id = $1 FOR UPDATE`, group.ID).Scan(new(uuid.UUID)); err != nil {
		t.Fatalf("lock group: %v", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE chat_participants SET role = 'member' WHERE chat_id = $1 AND user_id = $2`, group.ID, alice); err != nil {
		t.Fatalf("demote admin: %v", err)
	}

	lockCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	_, err = repo.ApplyMemberChanges(lockCtx, group.ID, alice, []uuid.UUID{bob}, "remove", "")
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("mutation while demotion lock is held = %v, want context deadline", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit demotion: %v", err)
	}
	if _, err := repo.ApplyMemberChanges(ctx, group.ID, alice, []uuid.UUID{bob}, "remove", ""); !errors.Is(err, ErrNotAdmin) {
		t.Fatalf("mutation after demotion = %v, want ErrNotAdmin", err)
	}

	if _, err := repo.AddMembersWithHistoryAndRotate(ctx, group.ID, alice, []uuid.UUID{uuid.New()}, true); !errors.Is(err, ErrNotAdmin) {
		t.Fatalf("add after demotion = %v, want ErrNotAdmin", err)
	}
	if err := repo.Patch(ctx, group.ID, alice, nil, nil, nil, nil, nil, nil, nil); !errors.Is(err, ErrNotAdmin) {
		t.Fatalf("patch after demotion = %v, want ErrNotAdmin", err)
	}
}
