# Wallet Client Test Guide

Quick guide to test the B3nd Wallet Client end-to-end.

## Prerequisites

1. **B3nd Backend Server** running on `http://localhost:8080`
2. **Wallet Server** running on `http://localhost:3001`

## Start Backend Server

```bash
# From the backend directory
deno run --allow-net --allow-read backend/server.ts
```

## Start Wallet Server

First, set up environment variables with server keys:

```bash
cd installations/wallet-server

# Create .env file with server keys
cp .env.example .env

# Generate server keys (or use existing ones)
# You'll need to set:
# - SERVER_IDENTITY_PRIVATE_KEY_PEM
# - SERVER_IDENTITY_PUBLIC_KEY_HEX
# - SERVER_ENCRYPTION_PRIVATE_KEY_PEM
# - SERVER_ENCRYPTION_PUBLIC_KEY_HEX

# Start the wallet server
deno task dev
```

## Run the Test

```bash
cd sdk/wallet
deno run --allow-net test.ts
```

## What the Test Does

The test script performs a complete workflow including error cases:

### Happy Path Tests:

1. ✅ **Initialize** - Creates wallet client
2. ✅ **Health Check** - Verifies server is running
3. ✅ **Signup** - Creates new user account
4. ✅ **Get Keys** - Retrieves user's public keys
5. ✅ **Write (Unencrypted)** - Writes profile data
6. ✅ **Write (Encrypted)** - Writes private data with encryption
7. ✅ **Read** - Reads data back from backend to verify
8. ✅ **Logout** - Clears session
9. ✅ **Login** - Re-authenticates with credentials
10. ✅ **Write Again** - Verifies auth works after re-login

### Error Case Tests:

11. ❌ **Wrong Password** - Verifies login fails with incorrect password
12. 🔒 **Unauthenticated Write** - Verifies write fails without active session

## Expected Output

```
🧪 B3nd Wallet Client Test

============================================================

📋 Test Configuration:
   Wallet Server: http://localhost:3001
   Backend: http://localhost:8080
   Username: testuser_1699999999999

============================================================


📦 Step 1: Initialize Wallet Client
------------------------------------------------------------
✅ Wallet client initialized


🏥 Step 2: Check Server Health
------------------------------------------------------------
✅ Server is ok
   Server: b3nd-wallet-server
   Timestamp: 2024-11-11T20:00:00.000Z

... (continues through all 10 steps)


❌ Step 11: Test Login with Wrong Password (Error Case)
------------------------------------------------------------
✅ Login correctly rejected with wrong password
   Error: Invalid username or password


🔒 Step 12: Test Write Without Authentication (Error Case)
------------------------------------------------------------
   Logged out - Authenticated: false
✅ Write correctly rejected without authentication
   Error: Not authenticated. Please login first.
   Re-authenticated for cleanup

============================================================
🎉 ALL TESTS PASSED!
============================================================

✅ Test Summary:
   • Wallet client initialized
   • Server health checked
   • User signup successful
   • Public keys retrieved
   • Unencrypted data written & read
   • Encrypted data written & read
   • Logout successful
   • Login successful
   • Re-authenticated write successful
   • Wrong password correctly rejected
   • Unauthenticated write correctly rejected

✨ All wallet operations working correctly!
```

## Troubleshooting

### Connection Refused

```
Error: Connection refused
```

**Solution**: Make sure both backend and wallet servers are running.

### Environment Variables Missing

```
Error: SERVER_IDENTITY_PRIVATE_KEY_PEM is required
```

**Solution**: Set all required environment variables in `.env` file.

### User Already Exists

```
Error: User already exists
```

**Solution**: Test creates unique usernames with timestamps, but if you run it
multiple times in the same millisecond, this can happen. Just run again.

## Test Data

The test creates:

- A unique user: `testuser_{timestamp}`
- Unencrypted profile data at: `mutable://test/{username}/profile`
- Encrypted private data at: `mutable://test/{username}/private`
- Final verification data at: `mutable://test/{username}/final`

All test data is isolated by username and won't conflict with other users.
