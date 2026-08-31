// The local database is IndexedDB. Tests run against a real in-memory
// implementation of it rather than a mock, so what they exercise is the same
// code path the till uses.
import 'fake-indexeddb/auto'
