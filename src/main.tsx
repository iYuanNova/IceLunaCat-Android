import { createRoot } from 'react-dom/client'
import { Studio } from './studio/Studio.js'
import './app/theme.css'
import './studio/studio.css'
createRoot(document.getElementById('root') as HTMLElement).render(<Studio />)
