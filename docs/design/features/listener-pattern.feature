Feature: Handler as Backend Service
  Backend services are handlers — portable functions that process
  requests and return responses. The same handler works embedded
  in a node's receive pipeline or connected remotely to a B3nd
  node. B3nd composes them; B3nd provides the protocol.

  Scenario: Handler embedded in a custom node
    Given a B3nd node with a vault handler in its receive pipeline
    And the handler is wired via when(matchesPattern, respondTo(handler))
    When a client sends a message matching the handler's pattern
    Then the node validates the message
    And respondTo decrypts the request and calls the handler
    And the handler processes the request and returns a response
    And respondTo encrypts the response and writes it to the reply URI
    And the client receives a synchronous acknowledgment

  Scenario: Handler connected remotely via polling
    Given a handler process connected to a remote B3nd node
    And the connection uses connect(remoteNode, { filter, handler })
    When a client writes an encrypted request to the handler's inbox URI
    Then the connection polls the node and discovers the new message
    And respondTo decrypts the request and calls the handler
    And the handler processes the request and returns a response
    And respondTo encrypts the response and writes it to the reply URI
    And the client reads and decrypts the response

  Scenario: Same handler in both modes
    Given a vault handler created with createVaultHandler(config)
    When the handler is embedded in a node via respondTo(handler)
    And the same handler is connected remotely via connect + respondTo
    Then both produce identical responses for identical requests
    And the handler function is unaware of its deployment mode

  Scenario: Moderation handler as embedded processor
    Given a moderation handler in a node's receive pipeline
    And it is wired as when(isUserContent, respondTo(moderationHandler))
    When a user writes content to a monitored URI pattern
    Then the handler evaluates the content against moderation rules
    And writes a moderation flag to a moderation URI
    And the flag is signed by the handler's identity

  Scenario: Indexing handler as embedded processor
    Given an indexing handler in a node's receive pipeline
    And it is wired as parallel(storageClient, when(isPost, respondTo(indexHandler)))
    When a user creates a new post
    Then the post is persisted by the storage client
    And the indexing handler updates a search index
    And both the post and index are available on the network
