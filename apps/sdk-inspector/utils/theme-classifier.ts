import {
  BACKEND_TYPES,
  type BackendInfo,
  type BackendType,
  classifyBackendType,
  classifyTestTheme,
  TEST_THEMES,
  type TestTheme,
  type ThemeInfo,
} from "./test-parser.ts";

export {
  BACKEND_TYPES,
  type BackendInfo,
  type BackendType,
  classifyBackendType,
  classifyTestTheme,
  TEST_THEMES,
  type TestTheme,
  type ThemeInfo,
};

/**
 * Group test files by theme
 */
export function groupTestsByTheme(
  testFiles: string[],
): Map<TestTheme, string[]> {
  const grouped = new Map<TestTheme, string[]>();

  // Initialize all themes
  for (const theme of TEST_THEMES) {
    grouped.set(theme.id, []);
  }
  grouped.set("other", []);

  // Classify each file
  for (const file of testFiles) {
    const theme = classifyTestTheme(file);
    const files = grouped.get(theme) || [];
    files.push(file);
    grouped.set(theme, files);
  }

  return grouped;
}

/**
 * Group test files by backend type
 */
export function groupTestsByBackend(
  testFiles: string[],
): Map<BackendType, string[]> {
  const grouped = new Map<BackendType, string[]>();

  // Initialize all backends
  for (const backend of BACKEND_TYPES) {
    grouped.set(backend.id, []);
  }
  grouped.set("other", []);

  // Classify each file
  for (const file of testFiles) {
    const backendType = classifyBackendType(file);
    const files = grouped.get(backendType) || [];
    files.push(file);
    grouped.set(backendType, files);
  }

  return grouped;
}

/**
 * Get all theme IDs in display order
 */
export function getThemeOrder(): TestTheme[] {
  return [...TEST_THEMES.map((t) => t.id), "other"];
}

/**
 * Get all backend IDs in display order
 */
export function getBackendOrder(): BackendType[] {
  return [...BACKEND_TYPES.map((b) => b.id), "other"];
}

/**
 * Get a user-friendly label for a theme
 */
export function getThemeLabel(themeId: TestTheme): string {
  const theme = TEST_THEMES.find((t) => t.id === themeId);
  return theme?.label || "Other";
}

/**
 * Get a user-friendly label for a backend
 */
export function getBackendLabel(backendId: BackendType): string {
  const backend = BACKEND_TYPES.find((b) => b.id === backendId);
  return backend?.label || "Other";
}
