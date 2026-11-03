package groups

import "github.com/gin-gonic/gin"

// Register mounts group routes on a JWT-protected group.
func Register(rg *gin.RouterGroup, c *Controller) {
	g := rg.Group("/groups")
	g.POST("", c.PostCreate)
	g.GET("", c.GetList)
	g.GET("/:id", c.GetOne)
	g.PATCH("/:id", c.Patch)
	g.POST("/:id/members", c.PostMembers)
	g.POST("/:id/members/bulk", c.PostBulkMembers)
	g.DELETE("/:id/members/:userId", c.DeleteMember)
	g.PATCH("/:id/members/:userId", c.PatchMemberRole)
	g.POST("/:id/leave", c.PostLeave)
	g.GET("/:id/achievements", c.GetAchievements)
	g.POST("/:id/achievements", c.PostAchievement)
	g.POST("/:id/achievements/:achievementId/awards", c.PostAchievementAward)
	// Sender keys: sealed blobs in, sealed blobs out. The server routes
	// them; it cannot read them.
	g.POST("/:id/sender-keys", c.PostSenderKeys)
	g.GET("/:id/sender-keys", c.GetSenderKeys)
}
