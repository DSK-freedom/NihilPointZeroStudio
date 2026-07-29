import { Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import FallbackBanner from './components/FallbackBanner'
import UpdateBanner from './components/UpdateBanner'
import AssistantWidget from './components/AssistantWidget'
import GuideWidget from './components/GuideWidget'
import CommandPalette from './components/CommandPalette'
import ToastHost from './components/Toast'
import ConfirmHost from './components/Confirm'
import IdeasPage from './pages/IdeasPage'
import AgentPage from './pages/AgentPage'
import SceneStudioPage from './pages/SceneStudioPage'
import WriterPage from './pages/WriterPage'
import ScriptPadPage from './pages/ScriptPadPage'
import VideoPage from './pages/VideoPage'
import TimelinePage from './pages/TimelinePage'
import StoryboardPage from './pages/StoryboardPage'
import PresenterPage from './pages/PresenterPage'
import RecorderPage from './pages/RecorderPage'
import ChartsPage from './pages/ChartsPage'
import PsxPage from './pages/PsxPage'
import NccplPage from './pages/NccplPage'
import AdvisorPage from './pages/AdvisorPage'
import LibraryPage from './pages/LibraryPage'
import SettingsPage from './pages/SettingsPage'
import ActivityLogPage from './pages/ActivityLogPage'
import { StudioProvider } from './store/StudioContext'

export default function App() {
  return (
    <StudioProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<IdeasPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/scenes" element={<SceneStudioPage />} />
            <Route path="/writer" element={<WriterPage />} />
            <Route path="/scriptpad" element={<ScriptPadPage />} />
            <Route path="/video" element={<VideoPage />} />
            <Route path="/storyboard" element={<StoryboardPage />} />
            <Route path="/presenter" element={<PresenterPage />} />
            <Route path="/recorder" element={<RecorderPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/charts" element={<ChartsPage />} />
            <Route path="/psx" element={<PsxPage />} />
            <Route path="/nccpl" element={<NccplPage />} />
            <Route path="/advisor" element={<AdvisorPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/activity" element={<ActivityLogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
        <FallbackBanner />
        <UpdateBanner />
        <AssistantWidget />
        <GuideWidget />
        <CommandPalette />
        <ToastHost />
        <ConfirmHost />
      </div>
    </StudioProvider>
  )
}
