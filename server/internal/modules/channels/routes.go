package channels

import "github.com/gin-gonic/gin"

func Register(rg *gin.RouterGroup, c *Controller) {
	g := rg.Group("/channels")
	g.POST("", c.PostCreate)
	g.GET("", c.GetList)
	g.GET("/handle-available", c.GetHandleAvailable)
	g.GET("/:id", c.GetOne)
	g.PATCH("/:id", c.Patch)
	g.POST("/:id/follow", c.PostFollow)
	g.DELETE("/:id/follow", c.DeleteFollow)
	g.GET("/:id/posts", c.GetPosts)

	// Membership. Readable by anyone who can see the channel; changes are
	// restricted to owners and admins inside the service.
	g.GET("/:id/members", c.GetMembers)
	g.POST("/:id/members", c.PostMember)

	// Invitations to help run a channel, from the invitee's side. Outside
	// /channels/:id because someone deciding on a request has not joined
	// anything yet.
	inv := rg.Group("/channel-invites")
	inv.GET("", c.GetMyInvites)
	inv.POST("/:inviteId/accept", c.PostAcceptInvite)
	inv.POST("/:inviteId/decline", c.PostDeclineInvite)
	g.PATCH("/:id/members/:uid", c.PatchMemberRole)
	g.DELETE("/:id/members/:uid", c.DeleteMember)
	g.POST("/:id/posts", c.PostPost)

	// Post-level actions (nested under /channels/posts to avoid route clash)
	p := rg.Group("/channel-posts")
	p.PATCH("/:postId", c.PatchPost)
	p.DELETE("/:postId", c.DeletePost)
	p.POST("/:postId/react", c.PostReact)
	p.DELETE("/:postId/react", c.DeleteReact)
	p.GET("/:postId/comments", c.GetComments)
	p.POST("/:postId/comments", c.PostComment)
	cr := rg.Group("/channel-comments")
	cr.POST("/:commentId/react", c.PostCommentReact)
	cr.DELETE("/:commentId/react", c.DeleteCommentReact)
}
