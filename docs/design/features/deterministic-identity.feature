Feature: Deterministic Identity from Credentials
  Users derive Ed25519 keypairs deterministically from credentials.
  The keypair IS the identity. No storage, no vault, no new concepts.

  Scenario: Password-based identity derivation
    Given an app with salt "recipe-app-7f3a"
    When user "alice" derives identity from password "s3cret-passw0rd"
    Then a deterministic Ed25519 signing keypair is produced
    And a deterministic X25519 encryption keypair is produced
    And the same credentials always produce the same keypairs
    And different credentials produce different keypairs

  Scenario: Identity enables authenticated writes
    Given user "alice" has derived identity from password "s3cret-passw0rd"
    When she writes signed data to her account URI
    Then the Firecat node accepts the write
    And the signature is verifiable by anyone with her public key

  Scenario: Identity recovery is re-derivation
    Given user "alice" previously wrote data with password-derived identity
    When she re-derives identity from the same password on a new device
    Then she recovers the same keypair
    And can read and write to all her existing URIs
