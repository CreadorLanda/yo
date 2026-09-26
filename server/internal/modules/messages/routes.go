package messages

import "github.com/gin-gonic/gin"

// Register wires the messaging endpoints onto a protected router group
// (one that already has middleware.Auth applied).
//
// WebSocket is registered on the public api group via RegisterWS because
// the upgrade handshake often carries the JWT in a query param.
func Register(rg *gin.RouterGroup, c *Controller) {
	// Chats
	rg.POST("/chats", c.PostChat)
	rg.GET("/chats", c.GetChats)

	// Messages within a chat
	rg.POST("/chats/:id/messages", c.PostMessage)
	rg.GET("/chats/:id/messages", c.GetMessages)
	rg.PATCH("/chats/:id/messages/:mid", c.PatchMessage)
	rg.DELETE("/chats/:id/messages/:mid", c.DeleteMessage)

	// Receipts / read / typing
	rg.POST("/chats/:id/receipts", c.PostReceipts)
	rg.GET("/chats/:id/messages/:mid/info", c.GetMessageInfo)
	rg.POST("/chats/:id/messages/:mid/open", c.PostMessageOpen)
	// Voting is its own endpoint: any participant may vote, whereas editing
	// the message that carries the poll is the author's alone.
	rg.POST("/chats/:id/messages/:mid/vote", c.PostPollVote)
	rg.POST("/chats/:id/read", c.PostRead)
	rg.POST("/chats/:id/typing", c.PostTyping)

	// Reactions
	rg.POST("/chats/:id/messages/:mid/reactions", c.PostReact)
	rg.DELETE("/chats/:id/messages/:mid/reactions", c.DeleteReact)
	rg.POST("/chats/:id/messages/:mid/star", c.PostStarMessage)
	rg.DELETE("/chats/:id/messages/:mid/star", c.DeleteStarMessage)

	// Chat actions
	rg.POST("/chats/:id/accept", c.PostAcceptChat)
	rg.POST("/chats/:id/report", c.PostReportChat)

	// Per-user chat management (pin / mute / archive, clear, delete)
	rg.PATCH("/chats/:id/settings", c.PatchChatSettings)
	rg.POST("/chats/:id/clear", c.PostClearChat)
	// Disappearing messages. Any participant may set it — it is a property
	// of the conversation, not of one side.
	rg.PUT("/chats/:id/disappearing", c.PutDisappearing)
	rg.DELETE("/chats/:id", c.DeleteChat)
}

// RegisterWS mounts GET /ws without JWT middleware (token parsed inside).
func RegisterWS(rg *gin.RouterGroup, c *Controller) {
	rg.GET("/ws", c.GetWS)
}
