import type { ReactNode } from 'react'
import TabBar from './TabBar'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import IconButton from '@/shared/ui/buttons/IconButton'
import Button from '@/shared/ui/buttons/Button'
import { CloseIcon, CodeIcon, SplitHorizontalIcon, SplitVerticalIcon, TerminalIcon } from '@/shared/ui/icons'
import type useConsoleTabs from '../hooks/useConsoleTabs'

type TabsApi = ReturnType<typeof useConsoleTabs>

type Props = {
  tabs: TabsApi
  isRedis: boolean
  onNewQuery: () => void
  /** Shown when a *whole* console has nothing open (not just one empty pane). */
  empty: ReactNode
  renderContent: (tab: any) => ReactNode
}

/**
 * The editor area: one pane, or two with a draggable divider between them.
 *
 * A pane is just a filter over the one flat tab list, so "split" is a property
 * of where tabs live rather than a second component tree — which is why a tab
 * can be dragged across and the split folds away on its own once pane 1 empties.
 */
export default function EditorPanes({ tabs: api, isRedis, onNewQuery, empty, renderContent }: Props) {
  const { tabs, activeByPane, focusedPane, splitDir, splitRatio, paneWrapRef } = api

  const renderPane = (p: number) => {
    const tab = api.tabInPane(p)
    return (
      <section
        key={p}
        onMouseDown={() => api.setFocusedPane(p)}
        style={splitDir ? { flexGrow: p === 0 ? splitRatio : 1 - splitRatio, flexBasis: 0 } : undefined}
        className={`flex min-h-0 min-w-0 flex-col ${splitDir ? '' : 'flex-1'}`}
      >
        <TabBar
          tabs={tabs.filter((t) => t.pane === p)}
          activeTab={activeByPane[p]}
          focused={focusedPane === p}
          onSelect={(key: string) => {
            api.setFocusedPane(p)
            api.setPaneActive(p, key)
          }}
          onClose={api.closeTab}
          onContextMenu={api.openTabMenu}
          onReorder={api.moveTab}
          onAdopt={(key: string, anchorKey: string) => api.adoptTab(p, key, anchorKey)}
          emptyHint={splitDir ? 'Drag a tab here' : 'No open tabs'}
          actions={
            p === 1 ? (
              <Tooltip label="Close split (keeps the tabs)" placement="bottom">
                <IconButton onClick={api.unsplit} aria-label="Close split">
                  <CloseIcon width={15} height={15} />
                </IconButton>
              </Tooltip>
            ) : (
              <div className="flex gap-1 max-[720px]:hidden">
                <Tooltip label={splitDir === 'vertical' ? 'Unsplit' : 'Split right'} placement="bottom">
                  <IconButton
                    active={splitDir === 'vertical'}
                    onClick={() => api.toggleSplit('vertical')}
                    aria-label="Split editor right"
                  >
                    <SplitVerticalIcon width={15} height={15} />
                  </IconButton>
                </Tooltip>
                <Tooltip label={splitDir === 'horizontal' ? 'Unsplit' : 'Split down'} placement="bottom">
                  <IconButton
                    active={splitDir === 'horizontal'}
                    onClick={() => api.toggleSplit('horizontal')}
                    aria-label="Split editor down"
                  >
                    <SplitHorizontalIcon width={15} height={15} />
                  </IconButton>
                </Tooltip>
              </div>
            )
          }
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {tab ? (
            renderContent(tab)
          ) : splitDir ? (
            // A pane with nothing in it: compact, since it only owns half the area.
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-xs text-ink-faint">Drag a tab here, or start a new one.</p>
              <Button variant="ghost" icon={isRedis ? TerminalIcon : CodeIcon} onClick={onNewQuery}>
                {isRedis ? 'New console' : 'New SQL query'}
              </Button>
            </div>
          ) : (
            empty
          )}
        </div>
      </section>
    )
  }

  return (
    <div
      ref={paneWrapRef}
      className={`flex min-h-0 flex-1 ${splitDir === 'horizontal' ? 'flex-col' : 'flex-row max-[720px]:flex-col'}`}
    >
      {renderPane(0)}
      {splitDir && (
        <div
          onMouseDown={api.startResize}
          className={`relative z-10 shrink-0 bg-edge transition-colors hover:bg-green ${
            splitDir === 'horizontal' ? 'h-px cursor-row-resize' : 'w-px cursor-col-resize'
          }`}
        >
          {/* Widen the grab area without widening the line itself. */}
          <span
            className={`absolute ${
              splitDir === 'horizontal' ? '-inset-y-1.5 inset-x-0' : '-inset-x-1.5 inset-y-0'
            }`}
          />
        </div>
      )}
      {splitDir && renderPane(1)}
    </div>
  )
}
