package stories

import "github.com/gin-gonic/gin"

func Register(rg *gin.RouterGroup, c *Controller) {
	g := rg.Group("/stories")
	g.POST("", c.PostCreate)
	g.GET("", c.GetFeed)
	// Before /:id so the literal path wins over the parameter.
	g.GET("/reactions", c.GetReactionCatalogue)
	g.GET("/:id", c.GetOne)
	g.POST("/:id/view", c.PostView)
	// Author only — who watched is as private as what they watched.
	g.GET("/:id/viewers", c.GetViewers)
	g.POST("/:id/react", c.PostReact)
	g.DELETE("/:id", c.Delete)

	// Blind channel — private replies that never name either party.
	g.POST("/:id/anon", c.PostAnonWrite)

	// Public comments, with one level of replies.
	g.GET("/:id/comments", c.GetComments)
	g.POST("/:id/comments", c.PostComment)
	rg.DELETE("/story-comments/:cid", c.DeleteComment)

	// Threads live outside /stories/:id: a thread outlives the story it
	// started from, and both parties reach it by thread id alone.
	th := rg.Group("/anon-threads")
	th.GET("", c.GetAnonInbox)
	th.GET("/:tid/messages", c.GetAnonMessages)
	th.POST("/:tid/messages", c.PostAnonReply)
	th.POST("/:tid/block", c.PostAnonBlock)
	th.POST("/:tid/reveal", c.PostAnonReveal)
}
