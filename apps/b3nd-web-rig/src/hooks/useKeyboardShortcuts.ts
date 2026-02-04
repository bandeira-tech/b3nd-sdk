import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';

export function useKeyboardShortcuts() {
  const { togglePanel, setMode, setSearchQuery, mode } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for modifier keys
      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;

      // Don't trigger shortcuts if user is typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true'
      ) {
        // Allow escape to blur input fields
        if (event.key === 'Escape') {
          target.blur();
          event.preventDefault();
          return;
        }
        // Don't process other shortcuts when typing
        return;
      }

      // Handle shortcuts
      switch (true) {
        // Ctrl/Cmd + B - Toggle left panel
        case isCtrl && !isShift && event.key === 'b':
          event.preventDefault();
          togglePanel('left');
          break;

        // Ctrl/Cmd + Shift + B - Toggle bottom panel
        case isCtrl && isShift && event.key === 'B':
          event.preventDefault();
          togglePanel('bottom');
          break;

        // Ctrl/Cmd + Shift + R - Toggle right panel
        case isCtrl && isShift && event.key === 'R':
          event.preventDefault();
          togglePanel('right');
          break;

        // Ctrl/Cmd + K - Quick search (activate search mode and focus)
        case isCtrl && event.key === 'k':
          event.preventDefault();
          setMode('search');
          // Focus search input if available
          setTimeout(() => {
            const searchInput = document.querySelector('input[placeholder*="search" i]') as HTMLInputElement;
            if (searchInput) {
              searchInput.focus();
            }
          }, 100);
          break;

        // Escape - Clear search or close modals
        case event.key === 'Escape':
          event.preventDefault();
          if (mode === 'search') {
            setSearchQuery('');
          }
          // Remove focus from current element
          (document.activeElement as HTMLElement)?.blur();
          break;

        // Number keys 1-3 for mode switching (when not typing)
        case event.key === '1' && !isCtrl && !isShift:
          event.preventDefault();
          setMode('filesystem');
          break;

        case event.key === '2' && !isCtrl && !isShift:
          event.preventDefault();
          setMode('search');
          break;

        case event.key === '3' && !isCtrl && !isShift:
          event.preventDefault();
          setMode('watched');
          break;

        default:
          // Don't prevent default for unhandled keys
          break;
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [togglePanel, setMode, setSearchQuery, mode]);
}
