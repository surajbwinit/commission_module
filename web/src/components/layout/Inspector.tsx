'use client';
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Info, X, PanelRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InspectorContent {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  body: React.ReactNode;
  /** Optional footer (save/cancel etc.). */
  footer?: React.ReactNode;
}

interface InspectorContextValue {
  content: InspectorContent | null;
  setContent: (c: InspectorContent | null) => void;
  visible: boolean;
  setVisible: (v: boolean) => void;
  toggle: () => void;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function InspectorProvider({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState<InspectorContent | null>(null);
  const [visible, setVisible] = useState(true);
  const toggle = useCallback(() => setVisible((v) => !v), []);
  return (
    <InspectorContext.Provider value={{ content, setContent, visible, setVisible, toggle }}>
      {children}
    </InspectorContext.Provider>
  );
}

export function useInspector() {
  const ctx = useContext(InspectorContext);
  if (!ctx) throw new Error('useInspector must be used within InspectorProvider');
  return ctx;
}

/** Pages call this hook to push content to the right inspector panel. */
export function useInspectorContent(content: InspectorContent | null, deps: React.DependencyList) {
  const { setContent } = useInspector();
  useEffect(() => {
    setContent(content);
    return () => setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Visual right-side panel that renders the current inspector content. */
export function Inspector() {
  const { content, visible, setVisible } = useInspector();

  if (!visible) return null;

  return (
    <aside className="w-80 shrink-0 border-l bg-card flex flex-col overflow-hidden">
      <header className="h-11 px-3 flex items-center justify-between border-b">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <PanelRight className="h-3 w-3" />
          Inspector
        </div>
        <button
          onClick={() => setVisible(false)}
          className="text-muted-foreground hover:text-foreground p-0.5 rounded"
          title="Hide inspector"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {content ? (
          <div className="flex flex-col h-full">
            <div className="px-4 pt-4 pb-3 border-b">
              <div className="text-sm font-semibold text-foreground">{content.title}</div>
              {content.subtitle && <div className="text-xs text-muted-foreground mt-0.5">{content.subtitle}</div>}
            </div>
            <div className="flex-1 px-4 py-4 text-sm space-y-3">
              {content.body}
            </div>
            {content.footer && <div className="px-4 py-3 border-t bg-muted/30">{content.footer}</div>}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <Info className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Select something on the left to see its details, properties and history here.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Toggle button that lives in the top bar — shows/hides the inspector. */
export function InspectorToggle() {
  const { visible, toggle } = useInspector();
  return (
    <button
      type="button"
      onClick={toggle}
      title={visible ? 'Hide inspector' : 'Show inspector'}
      className={cn(
        'inline-flex items-center justify-center h-9 w-9 rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors',
        visible && 'bg-accent text-foreground'
      )}
    >
      <PanelRight className="h-4 w-4" />
    </button>
  );
}
