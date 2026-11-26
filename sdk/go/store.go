package zwosocial

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Store keeps a bot's keys and sessions. They are secrets: keep the file
// out of version control and off shared disks.
type Store interface {
	// Get decodes the value at key into v and reports whether it existed.
	Get(key string, v any) (bool, error)
	Set(key string, v any) error
	Delete(key string) error
}

// MemoryStore keeps everything in memory; a restart loses every session.
type MemoryStore struct {
	mu   sync.Mutex
	data map[string][]byte
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{data: map[string][]byte{}} }

func (m *MemoryStore) Get(key string, v any) (bool, error) {
	m.mu.Lock()
	raw, ok := m.data[key]
	m.mu.Unlock()
	if !ok {
		return false, nil
	}
	return true, json.Unmarshal(raw, v)
}

func (m *MemoryStore) Set(key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.data[key] = raw
	m.mu.Unlock()
	return nil
}

func (m *MemoryStore) Delete(key string) error {
	m.mu.Lock()
	delete(m.data, key)
	m.mu.Unlock()
	return nil
}

// FileStore is a JSON file written atomically (temp file + rename), mode 0600.
// Its format is the TypeScript SDK's, so a bot can move between them.
type FileStore struct {
	path string
	mu   sync.Mutex
	data map[string]json.RawMessage
}

func NewFileStore(path string) *FileStore { return &FileStore{path: path} }

func (f *FileStore) load() error {
	if f.data != nil {
		return nil
	}
	f.data = map[string]json.RawMessage{}
	raw, err := os.ReadFile(f.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, &f.data)
}

func (f *FileStore) flush() error {
	raw, err := json.Marshal(f.data)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(f.path), 0o700); err != nil {
		return err
	}
	tmp := f.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, f.path)
}

func (f *FileStore) Get(key string, v any) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return false, err
	}
	raw, ok := f.data[key]
	if !ok {
		return false, nil
	}
	return true, json.Unmarshal(raw, v)
}

func (f *FileStore) Set(key string, v any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return err
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f.data[key] = raw
	return f.flush()
}

func (f *FileStore) Delete(key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return err
	}
	delete(f.data, key)
	return f.flush()
}
