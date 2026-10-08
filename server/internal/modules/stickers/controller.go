package stickers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

type Controller struct {
	svc *Service
}

func NewController(svc *Service) *Controller {
	return &Controller{svc: svc}
}

// PostPack — POST /stickers/packs
func (c *Controller) PostPack(ctx *gin.Context) {
	var req CreatePackRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	pack, issues, err := c.svc.CreatePack(ctx.Request.Context(), middleware.UserIDFrom(ctx), req)
	if err != nil {
		// Format problems come back per-file so the UI can point at the
		// sticker that failed instead of rejecting the whole import blindly.
		if errors.Is(err, ErrBadFormat) {
			ctx.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":  ErrBadFormat.Error(),
				"issues": issues,
			})
			return
		}
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, pack)
}

// PostFavorite — POST /stickers/favorites
func (c *Controller) PostFavorite(ctx *gin.Context) {
	var req SaveStickerRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	name := ctx.Query("name")
	if name == "" {
		name = "Saved"
	}
	pack, err := c.svc.SaveToFavorites(ctx.Request.Context(), middleware.UserIDFrom(ctx), req, name)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, pack)
}

// DeleteSticker — DELETE /stickers/:stickerId
func (c *Controller) DeleteSticker(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("stickerId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_sticker_id"})
		return
	}
	if err := c.svc.RemoveSticker(ctx.Request.Context(), id, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// GetPacks — GET /stickers/packs
func (c *Controller) GetPacks(ctx *gin.Context) {
	packs, err := c.svc.ListPacks(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if packs == nil {
		packs = []Pack{}
	}
	ctx.JSON(http.StatusOK, packs)
}

// GetPack — GET /stickers/packs/:id
func (c *Controller) GetPack(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_pack_id"})
		return
	}
	pack, err := c.svc.GetPack(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, pack)
}

// DeletePack — DELETE /stickers/packs/:id
func (c *Controller) DeletePack(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_pack_id"})
		return
	}
	if err := c.svc.DeletePack(ctx.Request.Context(), id, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrPackNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBadFormat):
		ctx.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	case errors.Is(err, ErrTooFewStickers), errors.Is(err, ErrTooManyStickers),
		errors.Is(err, ErrMediaNotFound):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}
