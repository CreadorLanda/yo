package auth

import "github.com/gin-gonic/gin"

// Register wires the auth endpoints onto the /api router group.
func Register(rg *gin.RouterGroup, c *Controller) {
	g := rg.Group("/auth")
	g.POST("/start", c.PostStart)
	g.POST("/verify", c.PostVerify)
	g.POST("/refresh", c.PostRefresh)
	g.POST("/logout", c.PostLogout)
}

func RegisterAuthed(rg *gin.RouterGroup, c *Controller) {
	g := rg.Group("/auth")
	g.POST("/reauth/start", c.PostReauthStart)
	g.POST("/email/request", c.PostEmailRequest)
	g.POST("/email/verify", c.PostEmailVerify)
	g.DELETE("/email", c.DeleteEmail)
	g.POST("/phone/change/start", c.PostPhoneChangeStart)
	g.POST("/phone/change/confirm", c.PostPhoneChangeConfirm)
}
