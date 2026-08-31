import { useCallback, useMemo, useReducer } from 'react'
import { newId, type OrderType, type SaleItemModifier } from '@pos/shared'
import type { CartDiscount, CartLine } from './checkout.ts'

/**
 * The order being built.
 *
 * Lines that are genuinely identical - same size, same modifiers, same note -
 * collapse into one line with a higher quantity, because a receipt reading
 * "3 x Iced Latte" is what a customer expects to see, not the same drink
 * printed three times.
 */

export interface CartState {
  lines: CartLine[]
  discounts: CartDiscount[]
  orderType: OrderType
  customerName: string
  note: string
}

const EMPTY: CartState = {
  lines: [],
  discounts: [],
  orderType: 'DINE_IN',
  customerName: '',
  note: '',
}

type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'id'> }
  | { type: 'setQuantity'; id: string; quantity: number }
  | { type: 'remove'; id: string }
  | { type: 'setNote'; id: string; note: string }
  | { type: 'setLoyaltyQty'; id: string; quantity: number }
  | { type: 'addDiscount'; discount: CartDiscount }
  | { type: 'removeDiscount'; id: string }
  | { type: 'setOrderType'; orderType: OrderType }
  | { type: 'setCustomer'; name: string }
  | { type: 'setOrderNote'; note: string }
  | { type: 'clear' }

/** Two lines merge only when every priced attribute matches. */
function signatureOf(line: Pick<CartLine, 'variantId' | 'modifiers' | 'note'>): string {
  const modifiers = line.modifiers
    .map((modifier: SaleItemModifier) => modifier.optionId)
    .slice()
    .sort()
    .join(',')
  return `${line.variantId}|${modifiers}|${line.note.trim()}`
}

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const signature = signatureOf(action.line)
      const index = state.lines.findIndex((line) => signatureOf(line) === signature)
      if (index >= 0) {
        const lines = state.lines.slice()
        const existing = lines[index]
        if (existing) lines[index] = { ...existing, quantity: existing.quantity + action.line.quantity }
        return { ...state, lines }
      }
      return { ...state, lines: [...state.lines, { ...action.line, id: newId() }] }
    }

    case 'setQuantity': {
      if (action.quantity <= 0) {
        return { ...state, lines: state.lines.filter((line) => line.id !== action.id) }
      }
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.id === action.id
            ? {
                ...line,
                quantity: action.quantity,
                // Reducing the line must not leave more claimed than remain.
                loyaltyFreeQty: Math.min(line.loyaltyFreeQty ?? 0, action.quantity),
              }
            : line,
        ),
      }
    }

    case 'remove':
      return { ...state, lines: state.lines.filter((line) => line.id !== action.id) }

    case 'setNote':
      return {
        ...state,
        lines: state.lines.map((line) => (line.id === action.id ? { ...line, note: action.note } : line)),
      }

    case 'setLoyaltyQty':
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.id === action.id
            ? { ...line, loyaltyFreeQty: Math.max(0, Math.min(action.quantity, line.quantity)) }
            : line,
        ),
      }

    case 'addDiscount': {
      // Only one statutory concession can apply to an order, and an ordinary
      // discount of the same kind should replace rather than stack silently.
      const filtered = state.discounts.filter((discount) => discount.type !== action.discount.type)
      return { ...state, discounts: [...filtered, action.discount] }
    }

    case 'removeDiscount':
      return { ...state, discounts: state.discounts.filter((discount) => discount.id !== action.id) }

    case 'setOrderType':
      return { ...state, orderType: action.orderType }

    case 'setCustomer':
      return { ...state, customerName: action.name }

    case 'setOrderNote':
      return { ...state, note: action.note }

    case 'clear':
      return { ...EMPTY }

    default:
      return state
  }
}

export function useCart() {
  const [state, dispatch] = useReducer(reducer, EMPTY)

  const actions = useMemo(
    () => ({
      add: (line: Omit<CartLine, 'id'>) => dispatch({ type: 'add', line }),
      setQuantity: (id: string, quantity: number) => dispatch({ type: 'setQuantity', id, quantity }),
      remove: (id: string) => dispatch({ type: 'remove', id }),
      setNote: (id: string, note: string) => dispatch({ type: 'setNote', id, note }),
      setLoyaltyQty: (id: string, quantity: number) => dispatch({ type: 'setLoyaltyQty', id, quantity }),
      addDiscount: (discount: CartDiscount) => dispatch({ type: 'addDiscount', discount }),
      removeDiscount: (id: string) => dispatch({ type: 'removeDiscount', id }),
      setOrderType: (orderType: OrderType) => dispatch({ type: 'setOrderType', orderType }),
      setCustomer: (name: string) => dispatch({ type: 'setCustomer', name }),
      setOrderNote: (note: string) => dispatch({ type: 'setOrderNote', note }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [],
  )

  const itemCount = useMemo(
    () => state.lines.reduce((count, line) => count + line.quantity, 0),
    [state.lines],
  )

  const isEmpty = state.lines.length === 0

  const quantityOf = useCallback(
    (variantId: string) =>
      state.lines
        .filter((line) => line.variantId === variantId)
        .reduce((count, line) => count + line.quantity, 0),
    [state.lines],
  )

  return { cart: state, ...actions, itemCount, isEmpty, quantityOf }
}
