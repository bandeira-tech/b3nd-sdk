Feature: OAuth Authentication via PKCE and Trusted Party
  SPAs and frontend-only apps use PKCE to safely obtain OAuth tokens
  without a backend server. A trusted party (listener or
  custom node) then verifies the token and provides a deterministic
  secret for key derivation.

  Background:
    PKCE (RFC 7636) binds the authorization code to the client that
    requested it, preventing interception attacks. The SPA handles
    the full OAuth flow client-side, then passes the ID token to a
    trusted party for identity derivation.

  Scenario: PKCE code verifier and challenge generation
    Given a client preparing an OAuth authorization request
    When it generates a PKCE code verifier
    Then the verifier is 43 characters of base64url-encoded random bytes
    And the verifier contains only unreserved URI characters
    When it generates a code challenge from the verifier
    Then the challenge is the SHA-256 hash of the verifier, base64url-encoded
    And the same verifier always produces the same challenge
    And different verifiers produce different challenges

  Scenario: SPA PKCE flow with custom node
    Given an SPA with no backend server
    And an app running its own B3nd node with OAuth support
    When the SPA generates a PKCE verifier and challenge
    And redirects to the OAuth provider with the challenge
    And the user authenticates with the provider
    And the SPA exchanges the authorization code with the code verifier
    Then the SPA receives an ID token directly from the provider
    When the SPA sends the ID token to the B3nd node
    Then the node verifies the token against the provider's JWKS
    And derives a deterministic secret via HMAC(nodeSecret, sub)
    And returns the secret encrypted to the client
    And the client derives identity from that secret
    And the same provider account always yields the same identity

  Scenario: SPA PKCE flow with listener
    Given an SPA with no backend server
    And a listener watching inbox messages for auth requests
    When the SPA completes the PKCE flow and obtains an ID token
    And writes an encrypted auth request with the ID token to the listener's inbox
    Then the listener decrypts and verifies the token
    And derives a deterministic secret via HMAC
    And writes an encrypted response to a known URI
    And the client reads the response and derives identity

  Scenario: PKCE prevents authorization code interception
    Given an attacker who intercepts an authorization code
    But does not have the original code verifier
    When the attacker attempts to exchange the code for tokens
    Then the provider rejects the exchange
    Because SHA-256(attacker_verifier) does not match the original challenge

  Scenario: OAuth via custom node (without PKCE, server-rendered apps)
    Given a server-rendered app with its own B3nd node
    When a user authenticates with a Google ID token obtained server-side
    Then the node verifies the token against Google's public keys
    And derives a deterministic secret via HMAC(nodeSecret, sub)
    And returns the secret encrypted to the client
    And the client derives identity from that secret
    And the same Google account always yields the same identity
