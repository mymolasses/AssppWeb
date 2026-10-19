package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"time"

	"github.com/majd/ipatool/v2/internal/sap/assets"
	"github.com/majd/ipatool/v2/internal/sap/machine"
)

type kbsyncGenerator func(context.Context, []byte, uint64) ([]byte, error)

func generateDownloadKBSync(ctx context.Context, hardwareID []byte, dsid uint64) ([]byte, error) {
	bundle, err := assets.Load(ctx)
	if err != nil {
		return nil, err
	}
	return machine.GenerateKBSync(ctx, bundle, hardwareID, dsid)
}

// This operation never receives a password, token or cookies, and never sends
// Store requests. Blobs are returned to the browser without server persistence.
func kbsyncResponse(payload request, generate kbsyncGenerator) response {
	hardwareID, err := hex.DecodeString(payload.DeviceID)
	if err != nil || len(hardwareID) != 6 {
		return response{Error: "invalid kbsync device identifier"}
	}
	dsid, err := strconv.ParseUint(payload.DSID, 10, 64)
	if err != nil || dsid == 0 {
		return response{Error: "invalid kbsync DSID"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	data, err := generate(ctx, hardwareID, dsid)
	if err != nil || ctx.Err() != nil || len(data) == 0 || len(data) > 512*1024 {
		return response{Error: "download signature generation failed"}
	}
	return response{KBSync: base64.StdEncoding.EncodeToString(data)}
}
