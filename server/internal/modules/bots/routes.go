package bots

import "github.com/gin-gonic/gin"

// Register wires the person-facing endpoints onto the authed (user JWT)
// group: managing your own bots, and adding bots to chats.
//
// The bot-facing API (/api/bot/v1) is mounted in server.go, because it
// reuses other modules' controllers — messages, keys, media — and modules do
// not import each other.
func Register(rg *gin.RouterGroup, c *Controller) {
	rg.POST("/bots", c.PostBot)
	rg.GET("/bots", c.GetMine)
	rg.GET("/bots/:id", c.GetBot)
	rg.PATCH("/bots/:id", c.PatchBot)
	rg.DELETE("/bots/:id", c.DeleteBot)
	rg.GET("/bots/:id/tokens", c.GetTokens)
	rg.POST("/bots/:id/tokens", c.PostToken)
	rg.DELETE("/bots/:id/tokens", c.DeleteTokens)
	rg.POST("/bots/:id/dm", c.PostDirect)

	rg.GET("/chats/:id/bots", c.GetChatBots)
	rg.POST("/chats/:id/bots", c.PostChatBot)
	rg.PATCH("/chats/:id/bots/:botId", c.PatchChatBot)
	rg.DELETE("/chats/:id/bots/:botId", c.DeleteChatBot)
}
