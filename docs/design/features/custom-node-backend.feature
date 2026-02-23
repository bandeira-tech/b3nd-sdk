Feature: Compose Primitives for Backend Services
  B3nd's compose layer provides the vocabulary for wiring handlers
  into nodes. The existing primitives (when, parallel, pipeline,
  emit) plus two new ones (respondTo, connect) make handlers
  fully portable between deployment modes.

  Scenario: respondTo wraps a handler as a Processor
    Given a handler function (request) => Promise<response>
    When wrapped with respondTo(handler, { identity })
    Then the result is a standard b3nd Processor
    And it can be used with when(), parallel(), pipeline()
    And it handles decrypt → call → encrypt → route internally

  Scenario: connect bridges a handler to a remote node
    Given a remote Firecat node accessible via HttpClient
    And a handler wrapped with respondTo(handler, { identity })
    When connect(remoteNode, { filter, handler }) is created
    Then it polls the remote node for new messages matching the filter
    And passes matching messages through the handler processor
    And tracks processed messages to avoid duplicates
    And start() returns a stop function for graceful shutdown

  Scenario: Node with handler in receive pipeline
    Given a node created with createValidatedClient
    And the write pipeline includes when(pattern, respondTo(handler))
    When a message matching the pattern is received
    Then validation runs first (msgSchema)
    And the message is persisted by the storage client
    And the handler runs via respondTo
    And encryption and response routing happen inside respondTo
    And the caller receives { accepted: true }

  Scenario: Connection strategies are interchangeable
    Given a handler wrapped with respondTo
    Then it can receive messages via receive() (embedded in node)
    And it can receive messages via poll (connect with polling)
    And it can receive messages via subscribe (future WebSocket)
    And it can receive messages via replicate (peer node)
    And the handler function is identical in all cases
