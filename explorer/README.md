b3nd/explorer provides a webapp with tools and views to explore the data from b3nd/persistence, including a filesystem-like ui for navigation and drilldown on paths and view values as files. It does not support creating data.

React app using shadcn and tailwind.

The app should support multiple backend apis and switching between them seamlessly, it should support a default static backend that enables mocked only returns that can be edited as fixtures statically in the repo, and should support add more backends at runtime, and should store the backends on localstorage to enable reuse over dev restarts.

## Navigation and accessibility

Application should be usable keyboard only, meaning tab navigation, focus control support and keyboard shortcuts for modes.

## Information Architecture

1) top
  1) brand superapp slim masthead
  2) explorer app modes
    1) filesystem like navigation
    2) Search
    3) Watched paths
    4) togle dark/light theme
2) content
  1) left panel nav, tool menu
  2) main app mode display
  3) right panel toggle display
  4) bottom panel toggle display
3) bottom superapp slim footer

## Visual

Mood: easy to use, simple data navigation tool, optimized for desktop/laptop work, calm, familiar

- brand superapp: dark minimalistic chrome
- app: information service application
