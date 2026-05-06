import React, { useEffect, useMemo, useRef, useState } from 'react'

export interface ComboboxOption {
  value: string
  label: string
  description?: string
}

export interface ComboboxGroup {
  label: string
  items: ComboboxOption[]
}

export function Combobox({
  value,
  onChange,
  groups,
  placeholder = 'Select…',
  disabled = false,
  searchPlaceholder
}: {
  value: string
  onChange: (v: string) => void
  groups: ComboboxGroup[]
  placeholder?: string
  disabled?: boolean
  searchPlaceholder?: string
  onDeleteItem?: (value: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const totalCount = allItems.length
  const selected = useMemo(() => allItems.find((o) => o.value === value), [allItems, value])

  // Filter groups by query
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    return groups
      .map((g) => ({
        label: g.label,
        items: g.items.filter(
          (i) =>
            !q ||
            i.value.toLowerCase().includes(q) ||
            (i.description?.toLowerCase().includes(q) ?? false)
        )
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, q])

  // Flat list of currently-visible items (for keyboard navigation)
  const flatVisible = useMemo(() => filtered.flatMap((g) => g.items), [filtered])
  const totalMatches = flatVisible.length

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Reset query + active index when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      // Focus search input on next frame so the open animation doesn't fight focus
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Keep activeIdx valid when filter narrows
  useEffect(() => {
    if (activeIdx >= totalMatches) setActiveIdx(Math.max(0, totalMatches - 1))
  }, [totalMatches, activeIdx])

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, totalMatches - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = flatVisible[activeIdx]
      if (pick) {
        onChange(pick.value)
        setOpen(false)
      }
    }
  }

  // Scroll active item into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLButtonElement>(
      `[data-cb-idx="${activeIdx}"]`
    )
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  let runningIdx = -1

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          width: '100%',
          padding: '8px 10px',
          textAlign: 'left',
          backgroundColor: '#1a1a1a',
          color: '#e0e0e0',
          border: `1px solid ${open ? '#3b82f6' : '#2d2d2d'}`,
          borderRadius: '6px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontFamily: 'inherit',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color 0.15s ease'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selected ? (
            <>
              <span style={{ fontWeight: 500 }}>{selected.label}</span>
              {selected.description && (
                <span style={{ color: '#666', fontSize: '0.78rem', marginLeft: '6px' }}>
                  · {selected.description.slice(0, 60)}
                </span>
              )}
            </>
          ) : value ? (
            <span style={{ color: '#fbbf24' }} title="Not found in current ffmpeg build">
              {value}
            </span>
          ) : (
            <span style={{ color: '#666' }}>{placeholder}</span>
          )}
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#666"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transition: 'transform 0.18s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)'
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            backgroundColor: '#171717',
            border: '1px solid #2a2a2a',
            borderRadius: '8px',
            boxShadow: '0 12px 28px rgba(0,0,0,0.55)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '300px',
            overflow: 'hidden'
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px', borderBottom: '1px solid #222' }}>
            <input
              ref={inputRef}
              type="text"
              placeholder={searchPlaceholder || `Search ${totalCount} options…`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIdx(0)
              }}
              onKeyDown={onSearchKey}
              style={{
                width: '100%',
                padding: '6px 9px',
                backgroundColor: '#0d0d0d',
                color: '#e0e0e0',
                border: '1px solid #222',
                borderRadius: '5px',
                fontSize: '0.8rem',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                outline: 'none'
              }}
            />
            {q && (
              <p style={{ margin: '5px 2px 0', fontSize: '0.68rem', color: '#555' }}>
                {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
              </p>
            )}
          </div>

          {/* List */}
          <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <p
                style={{
                  padding: '20px',
                  textAlign: 'center',
                  color: '#555',
                  margin: 0,
                  fontSize: '0.78rem'
                }}
              >
                No matches
              </p>
            ) : (
              filtered.map((group) => (
                <div key={group.label}>
                  <div
                    style={{
                      padding: '6px 12px',
                      fontSize: '0.62rem',
                      color: '#666',
                      fontWeight: 600,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      backgroundColor: '#141414',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1
                    }}
                  >
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    runningIdx++
                    const idx = runningIdx
                    const isSelected = item.value === value
                    const isActive = idx === activeIdx
                    return (
                      <button
                        key={item.value}
                        data-cb-idx={idx}
                        onClick={() => {
                          onChange(item.value)
                          setOpen(false)
                        }}
                        onMouseEnter={() => setActiveIdx(idx)}
                        style={{
                          width: '100%',
                          padding: '7px 12px',
                          textAlign: 'left',
                          backgroundColor: isActive
                            ? 'rgba(255,255,255,0.05)'
                            : isSelected
                              ? 'rgba(59,130,246,0.08)'
                              : 'transparent',
                          borderLeft: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                          border: 'none',
                          borderLeftWidth: '2px',
                          borderLeftStyle: 'solid',
                          borderLeftColor: isSelected ? '#3b82f6' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          color: isSelected ? '#60a5fa' : '#ccc',
                          fontFamily: 'inherit',
                          group: 'option'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: isSelected ? 600 : 500,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.label}
                            </span>
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          {item.description && (
                            <div
                              style={{
                                fontSize: '0.7rem',
                                color: isSelected ? '#7ca8e6' : '#666',
                                marginTop: '2px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {item.description}
                            </div>
                          )}
                        </div>
                        {onDeleteItem && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteItem(item.value)
                            }}
                            className="combobox-delete-btn"
                            title="Delete item"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#444',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              opacity: isActive ? 1 : 0,
                              transition: 'all 0.1s ease',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#444'; e.currentTarget.style.backgroundColor = 'transparent' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
