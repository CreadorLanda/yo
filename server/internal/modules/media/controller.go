package media

import (
	"errors"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/CreadorLanda/yo/server/internal/middleware"
)

type Controller struct {
	svc *Service
}

func NewController(svc *Service) *Controller {
	return &Controller{svc: svc}
}

// PostUpload — POST /media/upload  (multipart field "file")
func (c *Controller) PostUpload(ctx *gin.Context) {
	ctx.Request.Body = http.MaxBytesReader(ctx.Writer, ctx.Request.Body, c.svc.MaxRequestBytes())
	file, err := ctx.FormFile("file")
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			ctx.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "media_too_large"})
			return
		}
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "missing_file"})
		return
	}

	var width, height, duration *int
	if v := ctx.PostForm("width"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			width = &n
		}
	}
	if v := ctx.PostForm("height"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			height = &n
		}
	}
	if v := ctx.PostForm("duration_ms"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			duration = &n
		}
	}

	src, err := file.Open()
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_file"})
		return
	}
	defer src.Close()

	ct := file.Header.Get("Content-Type")
	obj, err := c.svc.Upload(
		ctx.Request.Context(),
		middleware.UserIDFrom(ctx),
		filepath.Base(file.Filename),
		ct,
		src,
		file.Size,
		width, height, duration,
	)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, obj)
}

// GetMeta — GET /media/:id
func (c *Controller) GetMeta(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	obj, err := c.svc.GetForUser(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, obj)
}

// GetFile — GET /media/:id/file  (auth required; streams bytes)
func (c *Controller) GetFile(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	obj, f, err := c.svc.OpenForUser(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	defer f.Close()

	// Record the download so retention can release the blob once everyone
	// who needs it has it.
	if uid := middleware.UserIDFrom(ctx); uid != uuid.Nil {
		if err := c.svc.NoteFetched(ctx.Request.Context(), id, uid); err != nil {
			log.Warn().Err(err).Msg("media: note fetch")
		}
	}

	ctx.Header("Content-Type", obj.MimeType)
	ctx.Header("Cache-Control", "private, max-age=86400")
	if obj.OriginalName != "" {
		disposition := mime.FormatMediaType("inline", map[string]string{
			"filename": obj.OriginalName,
		})
		ctx.Header("Content-Disposition", disposition)
	}

	// ServeContent handles Range requests, conditional GETs and the
	// Content-Length/Accept-Ranges headers. Streaming a copy of the whole
	// file instead meant a video had to download fully before it could
	// play, and seeking was impossible.
	name := obj.OriginalName
	if name == "" {
		name = obj.ID.String()
	}
	http.ServeContent(ctx.Writer, ctx.Request, name, obj.CreatedAt, f)
}

// Delete — DELETE /media/:id
func (c *Controller) Delete(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := c.svc.Delete(ctx.Request.Context(), id, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrTooLarge):
		ctx.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": err.Error()})
	case errors.Is(err, ErrUnsupported), errors.Is(err, ErrInvalidFile):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotOwner):
		ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}
