- Always use latest stable version of every dependency, it's important to be fresh and easy to evolve
- Always allow errors to bubble up and be treated by the users so they can figure out how to solve it, never suppress errors

# Code Design

1. Code in components or modules like ./thisproject/componenttype/componentname/<componentfiles...>
  - MUST not reference ENV or any other external input, instead should require the user of the component to interface with ENV and other user input as needed, and then pass all the data needed by the component instance either on initialization or as arguments or as setters as needed.
  - MUST not define default values of any kind and instead require the user to instantiate all required values explicitly and must fail in case a required value is not set.

  So for example, a component should never have anything like this:

  ```
  tablePrefix: Deno.env.get("POSTGRES_TABLE_PREFIX") || "b3nd",
  ```

  instead it should rely on the type system to require that its user passes all required values.
