package posts

import "github.com/gin-gonic/gin"

func Register(rg *gin.RouterGroup, c *Controller) {
	g := rg.Group("/posts")
	g.POST("", c.PostCreate)
	g.GET("", c.GetList)
	g.GET("/:id", c.GetOne)
	g.DELETE("/:id", c.Delete)
}
