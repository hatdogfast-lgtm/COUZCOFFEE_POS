/**
 * Stock, as a tab inside the menu screen.
 *
 * The screen was already self-contained, so it becomes a panel by being
 * re-exported rather than by being rewritten - there is only one copy of this
 * behaviour, wherever it happens to be shown.
 */
export { InventoryScreen as InventoryPanel } from '../InventoryScreen.tsx'
