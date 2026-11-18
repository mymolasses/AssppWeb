package main

import (
	"context"
	"github.com/majd/ipatool/v2/internal/sap/assets"
	"github.com/majd/ipatool/v2/internal/store/profile"
	"time"
)

// Administrator-only stdin operation. Cache public, hash-verified runtime
// resources before deployment; never receive credentials or provision an account.
func warmupRuntime() response {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if _, err := assets.Load(ctx); err != nil {
		return response{Error: "Could not prepare public Apple runtime assets"}
	}
	if _, err := profile.Load(ctx); err != nil {
		return response{Error: "Could not prepare Store runtime profile"}
	}
	return response{Prepared: true}
}
