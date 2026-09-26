import { TooltipProvider } from '@/components/ui/tooltip'
import { initTheme } from '@/store/settings'
import { EditorWindowPage } from './EditorWindowPage'

initTheme()

export default function EditorWindowApp() {
  return (
    <TooltipProvider>
      <EditorWindowPage />
    </TooltipProvider>
  )
}
