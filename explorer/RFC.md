# b3nd/explorer Implementation Plan

## Overview

The b3nd/explorer is a React-based web application that provides filesystem-like navigation and exploration of data stored in b3nd/persistence. It serves as a read-only interface to visualize and navigate the URL-based resource structure without supporting data creation or modification.

## Architecture

### Core Components

#### 1. API Adapter System
- **Abstract API Interface**: Define a common interface that all backend adapters must implement
- **Static/Mock Adapter**: Default adapter using fixtures stored in the repository
- **HTTP API Adapter**: Connects to b3nd/httpapi when available
- **Runtime Backend Management**: Allow adding/switching backends dynamically

#### 2. Data Models
- **PersistenceRecord**: Mirror the persistence layer's record structure with `ts` and `data`
- **NavigationNode**: Represent filesystem-like tree structure for UI navigation
- **SearchResult**: Structure for search functionality across paths and values

#### 3. Application State Management
- **Backend Configuration**: Store active backend and available backends in localStorage
- **Navigation State**: Current path, breadcrumb history, selected items
- **UI State**: Panel visibility, theme, focus management, keyboard shortcuts

### Technical Stack
- **React 19.1**: Core framework with hooks and context
- **TypeScript**: Full type safety throughout
- **shadcn/ui**: Component library
- **Tailwind CSS**: Styling framework
- **React Router**: Navigation and URL management
- **Zustand**: Lightweight state management
- **React Query**: Data fetching and caching

## API Adapter Design

### Interface Definition
```typescript
interface BackendAdapter {
  name: string;
  version: string;
  type: 'mock' | 'http' | 'websocket';
  baseUrl?: string;
  
  // Core operations
  listPath(path: string, options?: { page?: number; limit?: number }): Promise<PaginatedResponse<NavigationNode>>;
  readRecord(path: string): Promise<PersistenceRecord<any>>;
  searchPaths(query: string, filters?: SearchFilters, options?: { page?: number; limit?: number }): Promise<PaginatedResponse<SearchResult>>;
  
  // Metadata
  getSchema(): Promise<Record<string, any>>;
  healthCheck(): Promise<boolean>;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

### Static Mock Adapter
- Store fixtures in `src/fixtures/` directory structure matching persistence paths
- Support JSON files for different protocol/domain combinations
- Enable editing fixtures for rapid prototyping and testing
- Implement realistic delay simulation for better UX testing

### Backend Registry
- **Fixed Architecture**: Supported backends are compiled into the app as plugins
- **Version Support**: Multiple versions of the same backend type for development/troubleshooting
- **Configuration Storage**: Persist backend configs in localStorage as `b3nd-explorer-backends`
- **Runtime Addition**: UI for adding new backend instances with type/version selection
- **Validation**: Health check new backends before adding
- **Switching**: Seamless switching with loading states

## User Interface Architecture

### Layout Structure
```
┌─────────────────────────────────────────────┐
│ Brand Superapp Masthead (dark minimal)     │
├─────────────────────────────────────────────┤
│ Explorer App Modes Bar                      │
├─────┬─────────────────────────────┬─────────┤
│Left │ Main Content Area           │ Right   │
│Panel│                             │ Panel   │
│     │                             │(toggle) │
│     │                             │         │
├─────┴─────────────────────────────┴─────────┤
│ Bottom Panel (toggle)                       │
├─────────────────────────────────────────────┤
│ Superapp Footer                             │
└─────────────────────────────────────────────┘
```

### Application Modes

#### 1. Filesystem Navigation Mode
- **Tree View**: Collapsible tree structure in left panel
- **Breadcrumb Navigation**: Current path display with clickable segments
- **Main Content**: List/grid view of current directory contents
- **File Preview**: Show record data in formatted view (JSON, images, text)

#### 2. Search Mode
- **Search Interface**: Query input with filters for protocol, domain, path patterns
- **Results Display**: List of matching paths with preview snippets
- **Search History**: Recent searches stored locally
- **Advanced Filters**: Date ranges, data type filters, content search

#### 3. Watched Paths Mode
- **Path Subscription**: Add paths to watch list
- **Change Detection**: Highlight changes when switching backends
- **Bookmarks**: Favorite frequently accessed paths
- **Export**: Save watched paths configuration

### Accessibility and Keyboard Navigation

#### Keyboard Shortcuts
- `Tab/Shift+Tab`: Standard focus navigation
- `Ctrl/Cmd + K`: Quick search
- `Ctrl/Cmd + B`: Toggle left panel
- `Ctrl/Cmd + Shift + R`: Toggle right panel
- `Ctrl/Cmd + Shift + B`: Toggle bottom panel
- `Escape`: Close modals/panels, clear search
- `Enter/Space`: Select/activate items
- `Arrow Keys`: Navigate tree/list items

#### Focus Management
- **Focus Trapping**: In modals and panels
- **Focus Restoration**: Return focus after panel toggles
- **Visual Indicators**: Clear focus indicators throughout
- **Skip Links**: Jump to main content

### Theme System
- **Dark/Light Toggle**: System preference detection with manual override
- **Brand Consistency**: Dark minimal masthead in both themes
- **Accessibility**: WCAG AA contrast compliance
- **Persistence**: Theme choice stored in localStorage

## Component Architecture

### Core Components

#### `<ExplorerApp />`
- Root application component
- Backend adapter provider
- Theme provider
- Router setup

#### `<NavigationTree />`
- Recursive tree component for filesystem navigation
- Virtual scrolling for large datasets
- Lazy loading of tree branches
- Keyboard navigation support

#### `<ContentView />`
- Dynamic content rendering based on data type
- JSON formatter with syntax highlighting
- Image preview with zoom
- Text content with search highlighting

#### `<SearchInterface />`
- Query input with autocomplete
- Filter panels
- Results pagination
- Search history

#### `<BackendManager />`
- Backend configuration UI
- Health status indicators
- Add/remove/switch backends
- Connection testing

### Utility Components

#### `<Panel />`
- Reusable collapsible panel
- Resize handles
- Keyboard accessibility
- State persistence

#### `<DataFormatter />`
- Type-aware data display
- Syntax highlighting
- Copy to clipboard
- Export options

## Data Flow and State Management

### State Structure
```typescript
interface AppState {
  // Backend management
  backends: BackendConfig[];
  activeBackend: string;
  
  // Navigation
  currentPath: string;
  navigationHistory: string[];
  expandedPaths: Set<string>;
  
  // UI state
  panels: {
    left: boolean;
    right: boolean;
    bottom: boolean;
  };
  theme: 'light' | 'dark' | 'system';
  mode: 'filesystem' | 'search' | 'watched';
  
  // Search
  searchQuery: string;
  searchHistory: string[];
  searchResults: SearchResult[];
  
  // Watched paths
  watchedPaths: string[];
}
```

### Data Fetching Strategy
- **Direct Fetching**: No caching layer initially, but architecture supports future caching implementation
- **Action-Based**: View components dispatch actions that use adapter interfaces
- **Pagination Support**: Built-in pagination handling for large datasets
- **Error Boundaries**: Graceful error handling with retry options
- **Loading States**: Clear loading indicators without optimistic updates

## Mock Data Strategy

### Fixture Structure
```
src/fixtures/
├── protocols/
│   ├── users/
│   │   └── domain.json
│   └── apps/
│       └── domain.json
└── schemas/
    └── validation-rules.json
```

### Fixture Format
```typescript
interface FixtureData {
  protocol: string;
  domain: string;
  paths: Record<string, PersistenceRecord<any>>;
  metadata: {
    totalPaths: number;
    lastUpdated: string;
    description: string;
  };
}
```

### Realistic Data Generation
- **User Content**: Sample user data with realistic paths and content
- **App Data**: Various app examples with different data types
- **Edge Cases**: Empty directories, large datasets, special characters
- **Error States**: Invalid paths, network errors, permission denied

## Development Phases

### Phase 1: Foundation
1. **Project Setup**: React 19.1 app with TypeScript, Tailwind, shadcn/ui
2. **API Adapter Framework**: Plugin architecture with versioned adapters
3. **Action System**: Action dispatchers and adapter interface integration
4. **Basic Layout**: Masthead, panels, routing structure
5. **Mock Data**: Initial fixture set with realistic data

### Phase 2: Core Navigation
1. **Filesystem Mode**: Tree navigation and content display
2. **Path Navigation**: Breadcrumbs, URL synchronization
3. **Data Formatting**: JSON viewer, basic data types
4. **Theme System**: Dark/light mode implementation

### Phase 3: Enhanced Features
1. **Search Mode**: Full-text search and filtering
2. **Backend Management**: Add/switch backends UI
3. **Keyboard Navigation**: Complete accessibility implementation
4. **Watched Paths**: Bookmarking and change detection

### Phase 4: Polish and Testing
1. **Performance Optimization**: Virtual scrolling, code splitting
2. **Error Handling**: Comprehensive error boundaries and retry logic
3. **Testing Suite**: Unit, integration, and accessibility tests
4. **Documentation**: User guide and developer docs

## Resolved Technical Decisions

### 1. API Adapter Pattern ✅
**Decision**: Plugin architecture with fixed, compiled adapters supporting multiple versions. View components use actions that interact with adapter interfaces.

### 2. Data Caching Strategy ✅  
**Decision**: No caching initially, but architecture designed to support future caching implementation without major refactoring.

### 3. Large Dataset Handling ✅
**Decision**: Server-side pagination with API support for page/limit parameters.

### 4. Real-time Updates ✅
**Decision**: No real-time updates support.

## All Technical Decisions Resolved

### 5. Export/Import Functionality ✅
**Decision**: View-only with copy functionality. Users can view data and copy values as needed without dedicated export/import features.

### 6. Authentication Integration ✅
**Decision**: URL-based access management. No specific authentication handling needed in the explorer - backends handle their own auth via URLs.

### 7. Mobile Responsiveness ✅
**Decision**: Responsive for smaller screens and side-by-side work, but no mobile-specific features. Focus on desktop/laptop optimization with practical responsive breakpoints.

## File Structure
```
src/
├── components/
│   ├── layout/
│   ├── navigation/
│   ├── content/
│   └── common/
├── adapters/
│   ├── types.ts
│   ├── registry.ts
│   ├── mock/
│   │   └── v1/
│   └── http/
│       ├── v1/
│       └── v2/
├── actions/
├── stores/
│   └── appStore.ts
├── fixtures/
│   └── [protocol]/[domain].json
├── utils/
├── hooks/
└── types/
```

This implementation plan provides a solid foundation for building the b3nd/explorer while maintaining flexibility for future enhancements and iterations based on user feedback and evolving requirements.