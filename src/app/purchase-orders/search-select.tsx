'use client';

import { useId, useRef, useState } from 'react';

type Option = { id: string; label: string; searchText?: string };

/** A small keyboard-operable combobox that submits only the selected record ID. */
export function SearchSelect({
  id,
  name,
  label,
  options,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  id: string;
  name: string;
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.id === value);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const needle = query.trim().toLocaleLowerCase();
  const matches = options.filter((option) => !needle
    || `${option.label} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(needle));

  function select(option: Option) {
    onChange(option.id);
    setQuery('');
    setOpen(false);
    inputRef.current?.setCustomValidity('');
  }

  return <div className="search-select">
    <input type="hidden" name={name} value={value} />
    <input
      id={id}
      ref={inputRef}
      type="search"
      required={required}
      role="combobox"
      aria-label={label}
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
      autoComplete="off"
      placeholder={placeholder}
      value={open ? query : selected?.label ?? ''}
      onFocus={() => { setQuery(selected?.label ?? ''); setActiveIndex(0); setOpen(true); }}
      onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); onChange(''); event.target.setCustomValidity('Choose a result from the list.'); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, matches.length - 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
        if (event.key === 'Enter' && open && matches[activeIndex]) { event.preventDefault(); select(matches[activeIndex]); }
        if (event.key === 'Escape') { setOpen(false); setQuery(''); }
      }}
      onBlur={() => { window.setTimeout(() => setOpen(false), 100); }}
    />
    {open && <div className="search-select-options" id={listId} role="listbox" aria-label={`${label} choices`}>
      {matches.length ? matches.map((option, index) => <button
        type="button"
        role="option"
        aria-selected={option.id === value}
        id={`${listId}-${index}`}
        className={index === activeIndex ? 'search-select-option search-select-highlighted' : 'search-select-option'}
        key={option.id}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => select(option)}
      >{option.label}</button>) : <p className="search-select-empty" role="status">No matching {label.toLocaleLowerCase()}.</p>}
    </div>}
  </div>;
}
