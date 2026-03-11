# Encrypted WebSocket Relay Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual file-based blob exchange in threshold signing and DKG ceremonies with an encrypted WebSocket relay, while preserving the offline fallback.

**Architecture:** A standalone Go WebSocket server routes encrypted blobs between ceremony participants. Browser-side ECDH+AES-GCM provides E2E encryption. The relay is protocol-agnostic — it handles sessions, party assignment, pubkey distribution, and message routing. All ceremony logic stays in the browser.

**Tech Stack:** Go 1.22+ (relay server), TypeScript/React (browser), Web Crypto API (ECDH/AES-GCM), `nhooyr.io/websocket` (Go WS library)

**Spec:** `docs/superpowers/specs/2026-03-11-relay-ceremony-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `relay/main.go` | Entry point, CLI flags, HTTP server, graceful shutdown |
| `relay/session.go` | Session struct, party tracking, session code generation, lifecycle |
| `relay/hub.go` | WebSocket hub, connection accept, message dispatch, ping/pong |
| `relay/limits.go` | Per-IP connection tracking, session count enforcement |
| `relay/session_test.go` | Unit tests for session state machine |
| `relay/hub_test.go` | Integration tests for full WebSocket flow |
| `relay/go.mod` | Go module definition |
| `relay/go.sum` | Auto-generated dependency checksums (commit alongside go.mod) |
| `relay/Dockerfile` | Multi-stage build producing scratch-based image |
| `cabal/src/lib/relay-crypto.ts` | ECDH keygen, HKDF derivation, AES-256-GCM encrypt/decrypt |
| `cabal/src/lib/relay.ts` | RelayClient: WebSocket lifecycle, session management, encrypted messaging |

### Modified Files

| File | Change |
|------|--------|
| `shared/config.json` | Add `relayUrl` per network |
| `cabal/src/config.ts` | Read `relayUrl` from config, add to `NetworkConfig` |
| `cabal/src/components/OfflineSigner.tsx` | Add create/join/offline mode selector, relay session UI |
| `cabal/src/components/ThresholdSign.tsx` | Add relay transport mode, auto-send/receive blobs, auto-advance |
| `ceremony/src/components/DKGWizard.tsx` | Add relay transport mode, auto-send/receive blobs, auto-advance |

---

## Chunk 1: Go Relay Server

### Task 1: Go Module + Session Code Generation

**Files:**
- Create: `relay/go.mod`
- Create: `relay/session.go`
- Create: `relay/session_test.go`

- [ ] **Step 1: Initialize Go module**

```bash
cd /home/mwaddip/projects/od && mkdir -p relay
cd relay && go mod init github.com/mwaddip/orange-dollar/relay
go get nhooyr.io/websocket
```

- [ ] **Step 2: Write session code generator test**

File: `relay/session_test.go`

```go
package main

import (
	"testing"
)

func TestGenerateCode(t *testing.T) {
	code := generateCode()
	if len(code) != 6 {
		t.Fatalf("expected 6 chars, got %d: %q", len(code), code)
	}
	for _, c := range code {
		if !isValidCodeChar(c) {
			t.Fatalf("invalid char %c in code %q", c, code)
		}
	}
}

func TestGenerateCodeUniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		code := generateCode()
		if seen[code] {
			t.Fatalf("duplicate code %q after %d iterations", code, i)
		}
		seen[code] = true
	}
}

func TestGenerateCodeNoAmbiguous(t *testing.T) {
	ambiguous := "0O1IL"
	for i := 0; i < 1000; i++ {
		code := generateCode()
		for _, c := range code {
			for _, a := range ambiguous {
				if c == a {
					t.Fatalf("ambiguous char %c in code %q", c, code)
				}
			}
		}
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /home/mwaddip/projects/od/relay && go test -run TestGenerateCode -v
```

Expected: FAIL — `generateCode` undefined

- [ ] **Step 4: Implement session code generation and Session struct**

File: `relay/session.go`

```go
package main

import (
	"crypto/rand"
	"math/big"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// Session code alphabet: uppercase + digits, no ambiguous chars (0,O,1,I,L)
const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
const codeLength = 6

func generateCode() string {
	b := make([]byte, codeLength)
	max := big.NewInt(int64(len(codeAlphabet)))
	for i := range b {
		n, _ := rand.Int(rand.Reader, max)
		b[i] = codeAlphabet[n.Int64()]
	}
	return string(b)
}

func isValidCodeChar(c rune) bool {
	for _, a := range codeAlphabet {
		if c == a {
			return true
		}
	}
	return false
}

// Party represents a connected ceremony participant.
type Party struct {
	ID        int
	Pubkey    string // base64-encoded ECDH public key
	Token     string // reconnection token
	Conn      *websocket.Conn
	Connected bool
	mu        sync.Mutex
}

// Session represents a ceremony session.
type Session struct {
	Code      string
	Parties   int // expected party count
	Threshold int
	State     string // "waiting", "ready", "active"
	BaseURL   string

	PartyList []*Party
	mu        sync.RWMutex

	CreatedAt    time.Time
	LastActivity time.Time
}

// NewSession creates a session with the given parameters.
func NewSession(code string, parties, threshold int, baseURL string) *Session {
	now := time.Now()
	return &Session{
		Code:         code,
		Parties:      parties,
		Threshold:    threshold,
		State:        "waiting",
		BaseURL:      baseURL,
		PartyList:    make([]*Party, 0, parties),
		CreatedAt:    now,
		LastActivity: now,
	}
}

// AddParty adds a new party and returns the assigned party ID.
// Returns -1 if the session is full.
func (s *Session) AddParty(pubkey string, conn *websocket.Conn) (int, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.PartyList) >= s.Parties {
		return -1, ""
	}

	token := generateToken()
	id := len(s.PartyList)
	p := &Party{
		ID:        id,
		Pubkey:    pubkey,
		Token:     token,
		Conn:      conn,
		Connected: true,
	}
	s.PartyList = append(s.PartyList, p)
	s.LastActivity = time.Now()

	return id, token
}

// PartyCount returns the number of parties that have joined.
func (s *Session) PartyCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.PartyList)
}

// IsFull returns true if all expected parties have joined.
func (s *Session) IsFull() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.PartyList) >= s.Parties
}

// Pubkeys returns a map of partyId -> base64 pubkey.
func (s *Session) Pubkeys() map[int]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := make(map[int]string, len(s.PartyList))
	for _, p := range s.PartyList {
		m[p.ID] = p.Pubkey
	}
	return m
}

// GetParty returns the party with the given ID, or nil.
func (s *Session) GetParty(id int) *Party {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if id < 0 || id >= len(s.PartyList) {
		return nil
	}
	return s.PartyList[id]
}

// GetPartyByToken finds a party by reconnection token.
func (s *Session) GetPartyByToken(token string) *Party {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, p := range s.PartyList {
		if p.Token == token {
			return p
		}
	}
	return nil
}

// HasConnected returns true if at least one party is connected.
func (s *Session) HasConnected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, p := range s.PartyList {
		if p.Connected {
			return true
		}
	}
	return false
}

func generateToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	const hex = "0123456789abcdef"
	out := make([]byte, 64)
	for i, v := range b {
		out[i*2] = hex[v>>4]
		out[i*2+1] = hex[v&0x0f]
	}
	return string(out)
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /home/mwaddip/projects/od/relay && go test -run TestGenerateCode -v
```

Expected: all 3 tests PASS

- [ ] **Step 6: Add Session state tests**

Append to `relay/session_test.go`:

```go
func TestSessionAddParty(t *testing.T) {
	s := NewSession("ABC123", 3, 2, "https://example.com")
	if s.PartyCount() != 0 {
		t.Fatal("expected 0 parties")
	}

	id, token := s.AddParty("pk0", nil)
	if id != 0 || token == "" {
		t.Fatalf("expected id=0, got %d; token empty=%v", id, token == "")
	}
	if s.PartyCount() != 1 {
		t.Fatal("expected 1 party")
	}

	id, _ = s.AddParty("pk1", nil)
	if id != 1 {
		t.Fatalf("expected id=1, got %d", id)
	}

	id, _ = s.AddParty("pk2", nil)
	if id != 2 {
		t.Fatalf("expected id=2, got %d", id)
	}

	// Session full
	id, _ = s.AddParty("pk3", nil)
	if id != -1 {
		t.Fatalf("expected -1 for full session, got %d", id)
	}
}

func TestSessionIsFull(t *testing.T) {
	s := NewSession("ABC123", 2, 2, "https://example.com")
	if s.IsFull() {
		t.Fatal("should not be full with 0 parties")
	}
	s.AddParty("pk0", nil)
	if s.IsFull() {
		t.Fatal("should not be full with 1 party")
	}
	s.AddParty("pk1", nil)
	if !s.IsFull() {
		t.Fatal("should be full with 2 parties")
	}
}

func TestSessionPubkeys(t *testing.T) {
	s := NewSession("ABC123", 2, 2, "https://example.com")
	s.AddParty("pk_alice", nil)
	s.AddParty("pk_bob", nil)
	pks := s.Pubkeys()
	if pks[0] != "pk_alice" || pks[1] != "pk_bob" {
		t.Fatalf("unexpected pubkeys: %v", pks)
	}
}

func TestSessionReconnectByToken(t *testing.T) {
	s := NewSession("ABC123", 2, 2, "https://example.com")
	_, token := s.AddParty("pk0", nil)
	p := s.GetPartyByToken(token)
	if p == nil || p.ID != 0 {
		t.Fatal("expected to find party 0 by token")
	}
	if s.GetPartyByToken("wrong-token") != nil {
		t.Fatal("should not find party with wrong token")
	}
}
```

- [ ] **Step 7: Run all session tests**

```bash
cd /home/mwaddip/projects/od/relay && go test -v
```

Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
cd /home/mwaddip/projects/od
git add relay/
git commit -m "feat(relay): init Go module, session state, code generation"
```

---

### Task 2: WebSocket Hub + Wire Protocol

**Files:**
- Create: `relay/hub.go`
- Create: `relay/limits.go`
- Create: `relay/main.go`

- [ ] **Step 1: Implement the Hub (connection manager + message router)**

File: `relay/hub.go`

The Hub manages all sessions. It accepts WebSocket connections, dispatches incoming messages by `type` field (`create`, `join`, `reconnect`, `relay`), and sends responses.

Key types:
```go
// Msg is the top-level wire protocol message.
// IMPORTANT: Do NOT use omitempty on int fields — party 0 and to=0 are valid values.
type Msg struct {
	Type      string            `json:"type"`
	Parties   int               `json:"parties,omitempty"`
	Threshold int               `json:"threshold,omitempty"`
	Pubkey    string            `json:"pubkey,omitempty"`
	Session   string            `json:"session,omitempty"`
	Token     string            `json:"token,omitempty"`
	To        *int              `json:"to,omitempty"`
	From      *int              `json:"from,omitempty"`
	Payload   string            `json:"payload,omitempty"`
	PartyID   *int              `json:"partyId,omitempty"`
	Count     *int              `json:"count,omitempty"`
	Total     *int              `json:"total,omitempty"`
	URL       string            `json:"url,omitempty"`
	Pubkeys   map[int]string    `json:"pubkeys,omitempty"`
	Message   string            `json:"message,omitempty"`
}

// intPtr is a helper that returns a pointer to an int (for Msg fields).
func intPtr(i int) *int { return &i }

type Hub struct {
	sessions   map[string]*Session
	mu         sync.RWMutex
	limits     *Limits
	baseURL    string
	maxSessions int
}
```

Implement these handler methods on Hub:
- `handleCreate(conn, msg)` — validate parties/threshold/pubkey, generate session code (retry up to 10x on collision), create Session, add party 0, send `created` response
- `handleJoin(conn, msg)` — look up session by code, validate not full/not ready, add party, send personal `joined` to joiner (with partyId + token), broadcast `joined` to others. If now full: set state to "ready", broadcast `ready` with all pubkeys AND threshold (passed through for client UI)
- `handleReconnect(conn, msg)` — look up session, find party by token, re-associate conn, broadcast `reconnected`
- `handleRelay(conn, msg, senderPartyId, session)` — validate `to` != sender, validate `to` exists, forward message with `from` set to sender's partyId

Also implement:
- `broadcast(session, msg, exclude)` — send to all connected parties except `exclude`
- `sendTo(party, msg)` — JSON-encode and write to party's websocket conn
- `cleanup()` — goroutine that runs every 60s, removes sessions with no connected parties and LastActivity > 10 minutes ago

- [ ] **Step 2: Implement resource limits**

File: `relay/limits.go`

```go
type Limits struct {
	MaxSessions     int
	MaxParties      int
	MaxMessageBytes int
	MaxPerIP        int
	PingInterval    time.Duration
	AbandonTimeout  time.Duration

	ipConns map[string]int
	mu      sync.Mutex
}
```

Methods:
- `AddIP(ip string) bool` — increment count, return false if over limit
- `RemoveIP(ip string)` — decrement count
- `SessionCount(hub)` check — called before creating sessions

- [ ] **Step 3: Implement main.go entry point**

File: `relay/main.go`

```go
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"time"
)

// envOrDefault returns the env var value if set, otherwise the default.
func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envOrDefaultInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func main() {
	addr := flag.String("addr", envOrDefault("RELAY_ADDR", ":8080"), "listen address")
	baseURL := flag.String("base-url", envOrDefault("RELAY_BASE_URL", ""), "base URL for session links")
	maxSessions := flag.Int("max-sessions", envOrDefaultInt("RELAY_MAX_SESSIONS", 50), "max concurrent sessions")
	maxParties := flag.Int("max-parties", envOrDefaultInt("RELAY_MAX_PARTIES", 10), "max parties per session")
	maxMsg := flag.Int("max-message", envOrDefaultInt("RELAY_MAX_MESSAGE", 1048576), "max WebSocket message size in bytes")
	maxPerIP := flag.Int("max-per-ip", envOrDefaultInt("RELAY_MAX_PER_IP", 5), "max connections per IP")
	pingInterval := flag.Int("ping-interval", envOrDefaultInt("RELAY_PING_INTERVAL", 30), "WebSocket ping interval in seconds")
	abandonTimeout := flag.Int("abandon-timeout", envOrDefaultInt("RELAY_ABANDON_TIMEOUT", 600), "abandoned session cleanup in seconds")
	flag.Parse()

	limits := &Limits{
		MaxSessions:     *maxSessions,
		MaxParties:      *maxParties,
		MaxMessageBytes: *maxMsg,
		MaxPerIP:        *maxPerIP,
		PingInterval:    time.Duration(*pingInterval) * time.Second,
		AbandonTimeout:  time.Duration(*abandonTimeout) * time.Second,
		ipConns:         make(map[string]int),
	}

	hub := &Hub{
		sessions:    make(map[string]*Session),
		limits:      limits,
		baseURL:     *baseURL,
		maxSessions: *maxSessions,
	}

	go hub.cleanup()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.handleWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok"}`)
	})

	srv := &http.Server{Addr: *addr, Handler: mux}

	go func() {
		log.Printf("relay listening on %s", *addr)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("relay shut down")
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd /home/mwaddip/projects/od/relay && go build -o relay .
```

Expected: binary `relay` produced, no errors

- [ ] **Step 5: Commit**

```bash
cd /home/mwaddip/projects/od
git add relay/
git commit -m "feat(relay): WebSocket hub, wire protocol, resource limits"
```

---

### Task 3: Hub Integration Tests

**Files:**
- Create: `relay/hub_test.go`

- [ ] **Step 1: Write integration test for create + join + ready flow**

File: `relay/hub_test.go`

Test the full lifecycle: start a test HTTP server with the hub, connect 3 WebSocket clients, verify session creation, party join, and automatic `ready` broadcast with pubkeys.

```go
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

func newTestHub() (*Hub, *httptest.Server) {
	limits := &Limits{
		MaxSessions:     50,
		MaxParties:      10,
		MaxMessageBytes: 1 << 20,
		MaxPerIP:        10,
		PingInterval:    30 * time.Second,
		AbandonTimeout:  10 * time.Minute,
		ipConns:         make(map[string]int),
	}
	hub := &Hub{
		sessions:    make(map[string]*Session),
		limits:      limits,
		baseURL:     "https://test.example.com",
		maxSessions: 50,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.handleWS)
	srv := httptest.NewServer(mux)
	return hub, srv
}

func dial(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	return conn
}

func send(t *testing.T, conn *websocket.Conn, msg Msg) {
	t.Helper()
	b, _ := json.Marshal(msg)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}

func recv(t *testing.T, conn *websocket.Conn) Msg {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, b, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var msg Msg
	if err := json.Unmarshal(b, &msg); err != nil {
		t.Fatal(err)
	}
	return msg
}

func TestCreateJoinReady(t *testing.T) {
	_, srv := newTestHub()
	defer srv.Close()

	// Party 0 creates session
	c0 := dial(t, srv)
	defer c0.Close(websocket.StatusNormalClosure, "")

	send(t, c0, Msg{Type: "create", Parties: 3, Threshold: 2, Pubkey: "pk0"})
	resp := recv(t, c0)
	if resp.Type != "created" || resp.PartyID != 0 || resp.Session == "" || resp.Token == "" {
		t.Fatalf("unexpected created response: %+v", resp)
	}
	session := resp.Session

	// Party 1 joins
	c1 := dial(t, srv)
	defer c1.Close(websocket.StatusNormalClosure, "")

	send(t, c1, Msg{Type: "join", Session: session, Pubkey: "pk1"})
	r1 := recv(t, c1) // personal joined
	if r1.Type != "joined" || r1.PartyID != 1 || r1.Token == "" {
		t.Fatalf("party 1 did not get personal joined: %+v", r1)
	}
	// Party 0 gets broadcast joined
	r0 := recv(t, c0)
	if r0.Type != "joined" || r0.PartyID != 1 || r0.Count != 2 {
		t.Fatalf("party 0 did not get joined broadcast: %+v", r0)
	}

	// Party 2 joins — triggers ready
	c2 := dial(t, srv)
	defer c2.Close(websocket.StatusNormalClosure, "")

	send(t, c2, Msg{Type: "join", Session: session, Pubkey: "pk2"})
	recv(t, c2) // personal joined

	// All 3 should receive ready with pubkeys
	ready0 := recv(t, c0)
	if ready0.Type != "ready" || len(ready0.Pubkeys) != 3 {
		t.Fatalf("party 0 ready: %+v", ready0)
	}
	if ready0.Pubkeys[0] != "pk0" || ready0.Pubkeys[1] != "pk1" || ready0.Pubkeys[2] != "pk2" {
		t.Fatalf("wrong pubkeys: %v", ready0.Pubkeys)
	}
}

func TestRelayMessage(t *testing.T) {
	_, srv := newTestHub()
	defer srv.Close()

	// Create 2-party session and get to ready state
	c0 := dial(t, srv)
	defer c0.Close(websocket.StatusNormalClosure, "")
	c1 := dial(t, srv)
	defer c1.Close(websocket.StatusNormalClosure, "")

	send(t, c0, Msg{Type: "create", Parties: 2, Threshold: 2, Pubkey: "pk0"})
	created := recv(t, c0)

	send(t, c1, Msg{Type: "join", Session: created.Session, Pubkey: "pk1"})
	recv(t, c1) // joined
	recv(t, c0) // joined broadcast
	recv(t, c0) // ready
	recv(t, c1) // ready

	// Party 0 sends relay to party 1
	send(t, c0, Msg{Type: "relay", To: 1, Payload: "encrypted-blob-data"})
	r := recv(t, c1)
	if r.Type != "relay" || r.From != 0 || r.Payload != "encrypted-blob-data" {
		t.Fatalf("unexpected relay: %+v", r)
	}
}

func TestSessionFull(t *testing.T) {
	_, srv := newTestHub()
	defer srv.Close()

	c0 := dial(t, srv)
	defer c0.Close(websocket.StatusNormalClosure, "")

	send(t, c0, Msg{Type: "create", Parties: 2, Threshold: 2, Pubkey: "pk0"})
	created := recv(t, c0) // created — save session code
	session := created.Session

	c1 := dial(t, srv)
	defer c1.Close(websocket.StatusNormalClosure, "")
	send(t, c1, Msg{Type: "join", Session: session, Pubkey: "pk1"})
	recv(t, c1) // joined
	recv(t, c0) // joined broadcast
	recv(t, c0) // ready
	recv(t, c1) // ready

	// Session is now full — try to join with a third party
	c2 := dial(t, srv)
	defer c2.Close(websocket.StatusNormalClosure, "")
	send(t, c2, Msg{Type: "join", Session: session, Pubkey: "pk2"})
	r := recv(t, c2)
	if r.Type != "error" {
		t.Fatalf("expected error for full session, got: %+v", r)
	}
}

func TestSelfSendRejected(t *testing.T) {
	_, srv := newTestHub()
	defer srv.Close()

	c0 := dial(t, srv)
	defer c0.Close(websocket.StatusNormalClosure, "")
	c1 := dial(t, srv)
	defer c1.Close(websocket.StatusNormalClosure, "")

	send(t, c0, Msg{Type: "create", Parties: 2, Threshold: 2, Pubkey: "pk0"})
	created := recv(t, c0)

	send(t, c1, Msg{Type: "join", Session: created.Session, Pubkey: "pk1"})
	recv(t, c1) // joined
	recv(t, c0) // joined
	recv(t, c0) // ready
	recv(t, c1) // ready

	// Party 0 tries to relay to self
	send(t, c0, Msg{Type: "relay", To: 0, Payload: "self-data"})
	r := recv(t, c0)
	if r.Type != "error" {
		t.Fatalf("expected error for self-send, got: %+v", r)
	}
}
```

- [ ] **Step 2: Write reconnection integration test**

Append to `relay/hub_test.go`:

```go
func TestReconnect(t *testing.T) {
	_, srv := newTestHub()
	defer srv.Close()

	c0 := dial(t, srv)
	defer c0.Close(websocket.StatusNormalClosure, "")
	c1 := dial(t, srv)

	send(t, c0, Msg{Type: "create", Parties: 2, Threshold: 2, Pubkey: "pk0"})
	created := recv(t, c0)

	send(t, c1, Msg{Type: "join", Session: created.Session, Pubkey: "pk1"})
	joined1 := recv(t, c1) // personal joined with token
	recv(t, c0) // joined broadcast
	recv(t, c0) // ready
	recv(t, c1) // ready

	token := joined1.Token

	// Disconnect party 1
	c1.Close(websocket.StatusNormalClosure, "")
	left := recv(t, c0)
	if left.Type != "left" || (left.PartyID != nil && *left.PartyID != 1) {
		t.Fatalf("expected left for party 1, got: %+v", left)
	}

	// Reconnect party 1
	c1r := dial(t, srv)
	defer c1r.Close(websocket.StatusNormalClosure, "")
	send(t, c1r, Msg{Type: "reconnect", Session: created.Session, Token: token})

	reconnected := recv(t, c0)
	if reconnected.Type != "reconnected" || (reconnected.PartyID != nil && *reconnected.PartyID != 1) {
		t.Fatalf("expected reconnected for party 1, got: %+v", reconnected)
	}

	// Verify relay still works after reconnect
	send(t, c0, Msg{Type: "relay", To: intPtr(1), Payload: "post-reconnect-data"})
	r := recv(t, c1r)
	if r.Type != "relay" || r.Payload != "post-reconnect-data" {
		t.Fatalf("relay after reconnect failed: %+v", r)
	}
}
```

- [ ] **Step 3: Write limits enforcement test**

Append to `relay/hub_test.go`:

```go
func TestSessionLimitEnforced(t *testing.T) {
	limits := &Limits{
		MaxSessions:     2, // low limit for testing
		MaxParties:      10,
		MaxMessageBytes: 1 << 20,
		MaxPerIP:        10,
		PingInterval:    30 * time.Second,
		AbandonTimeout:  10 * time.Minute,
		ipConns:         make(map[string]int),
	}
	hub := &Hub{
		sessions:    make(map[string]*Session),
		limits:      limits,
		baseURL:     "https://test.example.com",
		maxSessions: 2,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.handleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Create 2 sessions (at limit)
	c0 := dial(t, srv)
	defer c0.Close(websocket.StatusNormalClosure, "")
	send(t, c0, Msg{Type: "create", Parties: 2, Threshold: 2, Pubkey: "pk0"})
	r0 := recv(t, c0)
	if r0.Type != "created" {
		t.Fatalf("first session should succeed: %+v", r0)
	}

	c1 := dial(t, srv)
	defer c1.Close(websocket.StatusNormalClosure, "")
	send(t, c1, Msg{Type: "create", Parties: 2, Threshold: 2, Pubkey: "pk1"})
	r1 := recv(t, c1)
	if r1.Type != "created" {
		t.Fatalf("second session should succeed: %+v", r1)
	}

	// Third session should be rejected
	c2 := dial(t, srv)
	defer c2.Close(websocket.StatusNormalClosure, "")
	send(t, c2, Msg{Type: "create", Parties: 2, Threshold: 2, Pubkey: "pk2"})
	r2 := recv(t, c2)
	if r2.Type != "error" {
		t.Fatalf("third session should be rejected: %+v", r2)
	}
}
```

- [ ] **Step 4: Run all integration tests**

```bash
cd /home/mwaddip/projects/od/relay && go test -v
```

Expected: all PASS

- [ ] **Step 5: Fix any issues, run all tests**

```bash
cd /home/mwaddip/projects/od/relay && go test -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
cd /home/mwaddip/projects/od
git add relay/
git commit -m "test(relay): integration tests for create/join/ready/relay flow"
```

---

### Task 4: Dockerfile

**Files:**
- Create: `relay/Dockerfile`

- [ ] **Step 1: Write multi-stage Dockerfile**

File: `relay/Dockerfile`

```dockerfile
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /relay .

FROM scratch
COPY --from=build /relay /relay
EXPOSE 8080
ENTRYPOINT ["/relay"]
```

- [ ] **Step 2: Verify Docker build**

```bash
cd /home/mwaddip/projects/od/relay && docker build -t od-relay .
```

Expected: successful build

- [ ] **Step 3: Commit**

```bash
cd /home/mwaddip/projects/od
git add relay/Dockerfile
git commit -m "feat(relay): add Dockerfile for scratch-based image"
```

---

## Chunk 2: Browser Crypto + Relay Client

### Task 5: ECDH + AES-GCM Crypto Helpers

**Files:**
- Create: `cabal/src/lib/relay-crypto.ts`

- [ ] **Step 1: Implement relay-crypto.ts**

File: `cabal/src/lib/relay-crypto.ts`

All Web Crypto API, no external dependencies.

```typescript
/**
 * E2E encryption for the relay: ECDH key agreement + AES-256-GCM.
 * All operations use the Web Crypto API (no external libraries).
 */

/** Generate an ephemeral ECDH P-256 keypair. */
export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // not extractable (private key stays in memory)
    ['deriveBits'],
  );
}

/** Export the public key as raw bytes (65 bytes uncompressed P-256). */
export async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

/** Import a raw public key (65 bytes) for ECDH. */
export async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

/**
 * Derive an AES-256-GCM key from ECDH shared secret + HKDF.
 * salt = session code (ASCII), info = "od-relay-v1".
 */
export async function deriveAESKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey,
  sessionCode: string,
): Promise<CryptoKey> {
  // Step 1: ECDH → shared secret bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    256,
  );

  // Step 2: Import shared bits as HKDF key material
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey'],
  );

  // Step 3: HKDF → AES-256-GCM key
  const salt = new TextEncoder().encode(sessionCode);
  const info = new TextEncoder().encode('od-relay-v1');

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt plaintext with AES-256-GCM. Returns IV (12 bytes) || ciphertext. */
export async function encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

/** Decrypt IV || ciphertext with AES-256-GCM. */
export async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

/** Compute session fingerprint: first 8 hex chars of SHA-256(sorted pubkeys). */
export async function sessionFingerprint(pubkeys: Map<number, Uint8Array>): Promise<string> {
  const sorted = [...pubkeys.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, pk]) => pk);
  let total = 0;
  for (const pk of sorted) total += pk.length;
  const concat = new Uint8Array(total);
  let offset = 0;
  for (const pk of sorted) {
    concat.set(pk, offset);
    offset += pk.length;
  }
  const hash = await crypto.subtle.digest('SHA-256', concat);
  return Array.from(new Uint8Array(hash))
    .slice(0, 4)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// -- Helpers for base64 encoding used in wire protocol --

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
```

- [ ] **Step 2: Verify it compiles (part of full build)**

```bash
cd /home/mwaddip/projects/od/cabal && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /home/mwaddip/projects/od
git add cabal/src/lib/relay-crypto.ts
git commit -m "feat: add ECDH + AES-GCM crypto helpers for relay E2E encryption"
```

---

### Task 6: RelayClient

**Files:**
- Create: `cabal/src/lib/relay.ts`

- [ ] **Step 1: Implement RelayClient**

File: `cabal/src/lib/relay.ts`

The RelayClient wraps a WebSocket connection, handles the wire protocol, and provides encrypted messaging via the crypto helpers from `relay-crypto.ts`.

Key implementation details:
- Constructor takes `relayUrl: string`
- `create(parties, threshold)` — generates ECDH keypair, opens WS, sends `create` message, resolves with session code + URL
- `join(session)` — generates ECDH keypair, opens WS, sends `join` message, resolves when `joined` received
- On `ready` message: import all peer pubkeys, derive AES keys per peer, set `ready = true`, emit `ready` event
- `send(to, payload)` — encrypt with peer's AES key, base64-encode, send `relay` message
- `broadcast(payload)` — calls `send()` for each peer (N-1 messages)
- On `relay` message: decrypt with sender's AES key, emit `message` event with raw `Uint8Array`
- Reconnection: on WS close, attempt reconnect using stored token (from sessionStorage). Re-derive keys if keypair still in memory.
- Stores token in `sessionStorage` for tab persistence
- Emits typed events: `joined`, `ready`, `message`, `left`, `reconnected`, `error`

Use a simple EventEmitter pattern (inline, no library) with both `on()` and `off()` methods:

```typescript
type EventMap = {
  joined: [partyId: number, count: number, total: number];
  ready: [pubkeys: Map<number, Uint8Array>];
  message: [from: number, payload: Uint8Array];
  left: [partyId: number];
  reconnected: [partyId: number];
  error: [message: string];
};

// Minimal typed event emitter
private listeners = new Map<string, Set<(...args: any[]) => void>>();

on<K extends keyof EventMap>(event: K, fn: (...args: EventMap[K]) => void): void {
  if (!this.listeners.has(event)) this.listeners.set(event, new Set());
  this.listeners.get(event)!.add(fn);
}

off<K extends keyof EventMap>(event: K, fn: (...args: EventMap[K]) => void): void {
  this.listeners.get(event)?.delete(fn);
}

private emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): void {
  this.listeners.get(event)?.forEach(fn => fn(...args));
}
```

**Key-loss detection on page reload:** On reconnect, if the ECDH keypair is gone (not in memory — e.g. page reload), the client detects this locally. It re-establishes the WS connection using the token from `sessionStorage`, but emits an `error` event with message `"Encryption keys lost — ceremony must restart"`. The UI should show this prominently and prevent further blob exchange.

Full implementation should be ~250-300 lines. The relay client is the main new abstraction — it completely hides WebSocket + encryption details from the ceremony components.

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/mwaddip/projects/od/cabal && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /home/mwaddip/projects/od
git add cabal/src/lib/relay.ts
git commit -m "feat: add RelayClient with E2E encrypted WebSocket messaging"
```

---

### Task 7: Config Changes

**Files:**
- Modify: `shared/config.json`
- Modify: `cabal/src/config.ts`

- [ ] **Step 1: Add relayUrl to shared/config.json**

Add `"relayUrl"` field to each network entry. For now use placeholder values:

```json
{
  "testnet": {
    "relayUrl": "wss://relay.odol.cash/ws",
    ...existing fields...
  }
}
```

- [ ] **Step 2: Update cabal/src/config.ts to read relayUrl**

Add `relayUrl?: string` to `RawNetworkEntry` interface and pass it through to `NetworkConfig`:

In `loadNetworks()`, add:
```typescript
relayUrl: entry.relayUrl,
```

Add to `NetworkConfig` interface:
```typescript
relayUrl?: string;
```

- [ ] **Step 3: Verify build**

```bash
cd /home/mwaddip/projects/od/cabal && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /home/mwaddip/projects/od
git add shared/config.json cabal/src/config.ts
git commit -m "feat: add relayUrl to network config"
```

---

## Chunk 3: Signing Ceremony Integration

### Task 8: OfflineSigner Mode Selector

**Files:**
- Modify: `cabal/src/components/OfflineSigner.tsx`

Currently the OfflineSigner has two modes: `'propose'` and `'join'` (with a `'choose'` initial state). We need to add relay session modes.

- [ ] **Step 1: Extend Mode type and add relay state**

Change `Mode` from `'choose' | 'propose' | 'join'` to `'choose' | 'propose' | 'join' | 'relay-create' | 'relay-join'`.

Add state:
```typescript
const [relayClient, setRelayClient] = useState<RelayClient | null>(null);
const [sessionCode, setSessionCode] = useState('');
const [sessionUrl, setSessionUrl] = useState('');
const [joinCode, setJoinCode] = useState('');
const [relayReady, setRelayReady] = useState(false);
const [relayPartyId, setRelayPartyId] = useState(-1);
const [fingerprint, setFingerprint] = useState('');
```

- [ ] **Step 2: Add mode selector UI**

In the `'choose'` mode render, add three options:

```tsx
{mode === 'choose' && (
  <div className="mode-selector">
    {networkConfig.relayUrl && (
      <>
        <button onClick={() => setMode('relay-create')}>Create Session</button>
        <button onClick={() => setMode('relay-join')}>Join Session</button>
      </>
    )}
    <button onClick={() => setMode('propose')}>Offline: Propose</button>
    <button onClick={() => setMode('join')}>Offline: Join</button>
  </div>
)}
```

- [ ] **Step 3: Implement relay-create mode**

When mode is `'relay-create'`:
- Show step selector + params (same as propose mode)
- Show threshold input (how many signers)
- "Create Session" button → creates RelayClient, calls `client.create(threshold, threshold)`
- On success: show session code + URL + "Waiting for parties" status
- On `ready` event: auto-build message, auto-start signing with relay transport

- [ ] **Step 4: Implement relay-join mode**

When mode is `'relay-join'`:
- Show text input for session code
- "Join" button → creates RelayClient, calls `client.join(code)`
- On `ready` event: receive proposal data (the creator broadcasts it as the first relay message after ready), display for verification, auto-start signing

- [ ] **Step 5: Pass relayClient to ThresholdSign**

Add optional `relayClient` prop to ThresholdSign. When present, ThresholdSign uses the relay for blob exchange instead of manual file I/O.

```tsx
{signing && (
  <ThresholdSign
    {...existingProps}
    relayClient={relayClient}   // NEW: optional
    relayPartyId={relayPartyId} // NEW: relay-assigned party ID
  />
)}
```

**Note:** Also add the `relayClient` and `relayPartyId` optional props to ThresholdSign's props interface now (in ThresholdSign.tsx) so that the build passes. The actual relay logic in ThresholdSign will be implemented in Task 9.

```typescript
// Add to ThresholdSignProps in ThresholdSign.tsx:
relayClient?: RelayClient | null;
relayPartyId?: number;
```

- [ ] **Step 6: Verify build**

```bash
cd /home/mwaddip/projects/od/cabal && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
cd /home/mwaddip/projects/od
git add cabal/src/components/OfflineSigner.tsx cabal/src/components/ThresholdSign.tsx
git commit -m "feat: add create/join/offline mode selector to signing ceremony"
```

---

### Task 9: ThresholdSign Relay Transport

**Files:**
- Modify: `cabal/src/components/ThresholdSign.tsx`

- [ ] **Step 1: Add relayClient prop and auto-send logic**

Add to ThresholdSignProps:
```typescript
relayClient?: RelayClient | null;
relayPartyId?: number;
```

When `relayClient` is provided:
- Skip manual party ID input — use `relayPartyId` and derive active party IDs from relay's `parties` map
- After each round computes a blob (`session.myRound1Blob`, etc.), auto-send to all peers:
  ```typescript
  if (relayClient) {
    const blobBytes = new TextEncoder().encode(blob);
    relayClient.broadcast(blobBytes);
  }
  ```
- Hide BlobExchange download/import UI — show a progress indicator instead

- [ ] **Step 2: Add auto-receive logic**

Subscribe to relay messages on mount:
```typescript
useEffect(() => {
  if (!relayClient) return;
  const handler = (from: number, payload: Uint8Array) => {
    const blobString = new TextDecoder().decode(payload);
    if (!sessionRef.current) return;
    const result = addBlob(sessionRef.current, blobString);
    if (result.ok) {
      setSession({ ...sessionRef.current });
    }
  };
  relayClient.on('message', handler);
  return () => relayClient.off('message', handler);
}, [relayClient]);
```

- [ ] **Step 3: Add auto-advance logic**

After setting session state (which triggers re-render), check if we have enough blobs to advance:

```typescript
useEffect(() => {
  if (!relayClient || !sessionRef.current || phase === 'idle') return;
  const s = sessionRef.current;
  const needed = s.activePartyIds.length - 1; // T-1

  if (phase === 'round1' && s.collectedRound1Hashes.size >= needed) {
    advanceToRound2();
  } else if (phase === 'round2' && s.collectedRound2Commitments.size >= needed) {
    advanceToRound3();
  } else if (phase === 'round3' && s.collectedRound3Responses.size >= needed) {
    doCombine();
  }
}, [session, phase, relayClient]); // session is the render-trigger state
```

Extract `advanceToRound2`, `advanceToRound3`, `doCombine` from the existing button click handlers into reusable functions.

- [ ] **Step 4: Show relay progress UI**

When `relayClient` is present, replace BlobExchange with a simpler progress view:

```tsx
{relayClient ? (
  <div className="relay-progress">
    <div>Round {roundNumber}: {collected.size}/{needed} blobs received</div>
    <PartyTracker parties={activePartyIds} collected={collected} selfId={selfId} />
  </div>
) : (
  <BlobExchange {...existingProps} />
)}
```

- [ ] **Step 5: Show session fingerprint**

After relay `ready` event, display the session fingerprint for verification:

```tsx
{fingerprint && (
  <div className="relay-fingerprint">
    Session fingerprint: <code>{fingerprint}</code>
    <span className="threshold-hint">Verify this matches on all devices</span>
  </div>
)}
```

- [ ] **Step 6: Verify build**

```bash
cd /home/mwaddip/projects/od/cabal && npx tsc --noEmit
```

- [ ] **Step 7: Build and test manually**

```bash
cd /home/mwaddip/projects/od/cabal && npm run build
```

- [ ] **Step 8: Commit**

```bash
cd /home/mwaddip/projects/od
git add cabal/src/components/ThresholdSign.tsx
git commit -m "feat: add relay transport with auto-send/receive/advance to ThresholdSign"
```

---

## Chunk 4: DKG Ceremony Integration

### Task 10: DKGWizard Relay Transport

**Files:**
- Modify: `ceremony/src/components/DKGWizard.tsx`

The DKGWizard is more complex than ThresholdSign — 4 phases with both broadcast and private blobs. The approach is the same: add an optional relay transport that replaces manual paste with auto-send/receive.

- [ ] **Step 1: Add relay mode to DKGWizard**

The DKGWizard currently starts with a role selection (initiator/joiner). Add a third path: relay mode.

Add to DKGState:
```typescript
relayClient: RelayClient | null;
transportMode: 'offline' | 'relay';
```

Add mode selector before role selection:
```tsx
{state.step === 'join' && !state.sessionId && (
  <div className="mode-selector">
    {relayUrl && (
      <>
        <button onClick={handleRelayCreate}>Create Session (Online)</button>
        <button onClick={handleRelayJoin}>Join Session (Online)</button>
      </>
    )}
    <button onClick={() => dispatch({ type: 'SET_TRANSPORT', mode: 'offline' })}>
      Offline Mode
    </button>
  </div>
)}
```

- [ ] **Step 2: Implement relay create for DKG**

`handleRelayCreate`:
- Show threshold/parties/level inputs
- On "Create Session" → create RelayClient, call `create(parties, threshold)`
- On `ready` → generate session config (sessionId, params), broadcast it to all peers as first relay message
- Auto-set partyId to 0, auto-advance to commit phase

- [ ] **Step 3: Implement relay join for DKG**

`handleRelayJoin`:
- Show session code input
- On "Join" → create RelayClient, call `join(code)`
- On `ready` → wait for session config message from party 0
- On session config received → decode, initialize DKG instance, auto-set partyId from relay, advance to commit phase

- [ ] **Step 4: Add auto-send after each phase computation**

After each phase produces blobs, auto-send them via relay:

**Phase 1 (commit):**
```typescript
// After encodePhase1Broadcast()
if (state.relayClient) {
  const blobBytes = new TextEncoder().encode(myPhase1Blob);
  state.relayClient.broadcast(blobBytes);
}
```

**Phase 2 (reveal):**
```typescript
// Broadcast blob
if (state.relayClient) {
  state.relayClient.broadcast(new TextEncoder().encode(myPhase2PubBlob));
  // Private blobs — each to specific party
  for (const [targetId, privBlob] of myPhase2PrivBlobs) {
    state.relayClient.send(targetId, new TextEncoder().encode(privBlob));
  }
}
```

**Phase 3 (masks):**
```typescript
if (state.relayClient) {
  for (const [targetId, privBlob] of myPhase3PrivBlobs) {
    state.relayClient.send(targetId, new TextEncoder().encode(privBlob));
  }
}
```

**Phase 4 (aggregate):**
```typescript
if (state.relayClient) {
  state.relayClient.broadcast(new TextEncoder().encode(myPhase4Blob));
}
```

- [ ] **Step 5: Add auto-receive handler**

Subscribe to relay messages and feed them through existing `handlePaste` logic:

```typescript
useEffect(() => {
  if (!state.relayClient) return;
  const handler = (_from: number, payload: Uint8Array) => {
    const blobString = new TextDecoder().decode(payload);
    handlePaste(blobString); // existing smart-paste logic
  };
  state.relayClient.on('message', handler);
  return () => state.relayClient!.off('message', handler);
}, [state.relayClient, handlePaste]);
```

- [ ] **Step 6: Add auto-advance for DKG phases**

The DKGWizard already has `useEffect` hooks that auto-compute the next phase when enough blobs are collected. These should continue to work — the relay just feeds blobs in faster. Verify that the existing auto-compute effects trigger correctly when blobs arrive via relay.

The key effects to check:
- Phase 1 → 2: triggers when `collectedPhase1.length === parties - 1` (N-1 blobs from other parties)
- Phase 2 → 3: triggers when all Phase 2 pub + priv collected (N-1 broadcasts + N-1 privates)
- Phase 3 → 4: triggers when all Phase 3 priv collected
- Phase 4 → complete: triggers when all Phase 4 broadcasts collected

If the existing effects use a "Click to continue" button guard, add a bypass when in relay mode:
```typescript
if (state.transportMode === 'relay') {
  // Auto-advance without button click
  runPhase2Computation();
}
```

- [ ] **Step 7: Hide manual paste UI in relay mode**

When `transportMode === 'relay'`, hide the textarea/file-import UI and show a progress indicator instead:

```tsx
{state.transportMode === 'relay' ? (
  <div className="relay-progress">
    Phase {phaseNumber}: {collected}/{expected} blobs received
    <PartyStatusGrid parties={state.parties} ... />
  </div>
) : (
  // existing paste UI
)}
```

- [ ] **Step 8: Skip manual party ID selection in relay mode**

In relay mode, party IDs are assigned by the relay server. Remove the party ID dropdown and use `relayClient.partyId` directly:

```typescript
if (state.transportMode === 'relay' && state.relayClient) {
  dispatch({ type: 'SET_PARTY_ID', partyId: state.relayClient.partyId });
}
```

- [ ] **Step 9: Verify ceremony build**

```bash
cd /home/mwaddip/projects/od/ceremony && npx tsc --noEmit && npm run build
```

- [ ] **Step 10: Verify cabal build (shared lib)**

```bash
cd /home/mwaddip/projects/od/cabal && npm run build
```

- [ ] **Step 11: Commit**

```bash
cd /home/mwaddip/projects/od
git add ceremony/src/components/DKGWizard.tsx
git commit -m "feat: add relay transport with auto-send/receive to DKG ceremony"
```

---

### Task 11: Build, Zip, and Push

**Files:**
- Build artifacts

- [ ] **Step 1: Build all apps**

```bash
cd /home/mwaddip/projects/od/cabal && npm run build && npm run build:offline
cd /home/mwaddip/projects/od/ceremony && npm run build
```

- [ ] **Step 2: Build relay binary**

```bash
cd /home/mwaddip/projects/od/relay && go build -o relay .
```

- [ ] **Step 3: Create zip files**

```bash
cd /home/mwaddip/projects/od
# Cabal (online admin + offline signer)
cd cabal/dist && cp ../dist-offline/offline-sign.html permafrost-signer.html
cd /home/mwaddip/projects/od && rm -f od-cabal.zip && cd cabal/dist && zip -r /home/mwaddip/projects/od/od-cabal.zip .
# Ceremony (DKG)
cd /home/mwaddip/projects/od && rm -f ceremony-dist.zip && cd ceremony/dist && zip -r /home/mwaddip/projects/od/ceremony-dist.zip .
```

- [ ] **Step 4: Push to GitHub**

```bash
cd /home/mwaddip/projects/od && git push origin master
```
