import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { filterNexusPaletteItems, type NexusPaletteItem } from "./nexus-model";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-background px-1 font-sans text-xs text-muted-foreground">
      {children}
    </kbd>
  );
}

export function NexusPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly NexusPaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const filtered = useMemo(
    () => filterNexusPaletteItems(items, query),
    [items, query],
  );

  const changeOpen = (next: boolean) => {
    if (!next) {
      setQuery("");
      setIndex(0);
    }
    onOpenChange(next);
  };
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (item: NexusPaletteItem | undefined) => {
    if (item === undefined) return;
    pendingRef.current = item.run;
    changeOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((value) => Math.min(value + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(filtered[index]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="top-[12%] max-w-[620px] translate-y-0 gap-0 overflow-hidden p-0 font-sans shadow-lg sm:rounded-2xl"
        onAfterCloseAutoFocus={() => {
          const run = pendingRef.current;
          pendingRef.current = null;
          run?.();
        }}
        data-testid="nexus-palette"
      >
        <DialogTitle className="sr-only">Search or jump to</DialogTitle>
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Icon name="Search" className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, chats and actions…"
            aria-label="Search pages, chats and actions"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          ref={listRef}
          className="max-h-[52vh] overflow-y-auto p-1.5"
          role="listbox"
          aria-label="Results"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-7 text-center text-sm text-muted-foreground">
              No results for “{query}”
            </p>
          ) : null}
          {filtered.map((item, itemIndex) => {
            const header =
              item.group !== filtered[itemIndex - 1]?.group ? item.group : null;
            return (
              <div key={item.id}>
                {header ? (
                  <div className="px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {header}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={itemIndex === index}
                  data-active={itemIndex === index}
                  onMouseEnter={() => setIndex(itemIndex)}
                  onClick={() => choose(item)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground",
                    itemIndex === index && "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon
                    name={item.icon}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.shortcut ? (
                    <span className="flex gap-1">
                      {item.shortcut.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>Navigate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd>Open
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Esc</Kbd>Close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
