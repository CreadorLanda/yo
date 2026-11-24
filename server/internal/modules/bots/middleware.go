package bots

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// Auth authenticates `Authorization: Bot <token>` and installs the bot as the
// request's principal, with the same context keys as a user session — so the
// person-facing controllers mounted under /api/bot/v1 serve bots unchanged.
func Auth(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := svc.Authenticate(c.Request.Context(), c.GetHeader("Authorization"))
		if err != nil {
			if errors.Is(err, ErrInvalidToken) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": ErrInvalidToken.Error()})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
			return
		}
		middleware.SetBotPrincipal(c, p.BotID, p.DeviceID)
		c.Next()
	}
}

// RequireChatScope guards a /chats/:id/... route: the bot must be installed
// in that chat with `scope`. A chat it is not in reads as not found.
func RequireChatScope(svc *Service, scope Scope) gin.HandlerFunc {
	return func(c *gin.Context) {
		chatID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
			return
		}
		err = svc.RequireScope(c.Request.Context(), chatID, middleware.UserIDFrom(c), scope)
		switch {
		case err == nil:
			c.Next()
		case errors.Is(err, ErrNotInstalled):
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "chat_not_found"})
		case errors.Is(err, ErrScopeMissing):
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": ErrScopeMissing.Error(), "scope": scope})
		default:
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
		}
	}
}

// Limiter is a fixed-window counter. Redis in production, nothing in tests.
type Limiter interface {
	// Allow counts one hit for key and reports whether it is within limit,
	// and if not, how long until the window resets.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error)
}

// RedisLimiter counts in Redis so the limit holds across API instances.
type RedisLimiter struct{ rdb *goredis.Client }

func NewRedisLimiter(rdb *goredis.Client) *RedisLimiter { return &RedisLimiter{rdb: rdb} }

func (l *RedisLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error) {
	if l == nil || l.rdb == nil {
		return true, 0, nil
	}
	slot := time.Now().UnixNano() / int64(window)
	k := fmt.Sprintf("botrl:%s:%d", key, slot)
	n, err := l.rdb.Incr(ctx, k).Result()
	if err != nil {
		return true, 0, err
	}
	if n == 1 {
		_ = l.rdb.Expire(ctx, k, window).Err()
	}
	if n > int64(limit) {
		reset := time.Duration(int64(window) - time.Now().UnixNano()%int64(window))
		return false, reset, nil
	}
	return true, 0, nil
}

// Limits a bot may use. Generous for normal work, tight enough that a bot
// gone wrong cannot flood a chat.
const (
	BotRequestsPerMinute  = 600
	ChatMessagesPerMinute = 30
)

// RateLimit applies the per-bot budget to every bot request, and the
// per-chat send budget to routes with a chat id. A failure to reach Redis
// lets the request through: rate limiting must not take bots down with it.
func RateLimit(l Limiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if l == nil {
			c.Next()
			return
		}
		bot := middleware.UserIDFrom(c).String()
		if !allow(c, l, "bot:"+bot, BotRequestsPerMinute) {
			return
		}
		if chat := c.Param("id"); chat != "" && c.Request.Method == http.MethodPost {
			if !allow(c, l, "chat:"+chat+":"+bot, ChatMessagesPerMinute) {
				return
			}
		}
		c.Next()
	}
}

func allow(c *gin.Context, l Limiter, key string, limit int) bool {
	ok, retry, err := l.Allow(c.Request.Context(), key, limit, time.Minute)
	if err != nil || ok {
		return true
	}
	secs := int(retry.Seconds()) + 1
	c.Header("Retry-After", strconv.Itoa(secs))
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": ErrRateLimited.Error(), "retry_after": secs})
	return false
}
