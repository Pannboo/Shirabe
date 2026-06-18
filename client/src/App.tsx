import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import PublicDashboard from "./pages/PublicDashboard";
import PublicArtists from "./pages/PublicArtists";
import PublicAlbums from "./pages/PublicAlbums";
import PublicRewind from "./pages/PublicRewind";
import Login from "./pages/Login";
import MeDashboard from "./pages/MeDashboard";
import MeArtists from "./pages/MeArtists";
import MeAlbums from "./pages/MeAlbums";
import MeRewind from "./pages/MeRewind";
import ArtistDetail from "./pages/ArtistDetail";
import AlbumDetail from "./pages/AlbumDetail";
import TrackDetail from "./pages/TrackDetail";
import Library from "./pages/Library";
import Discover from "./pages/Discover";
import Queue from "./pages/Queue";
import Review from "./pages/Review";
import Settings from "./pages/Settings";
import { useAuth } from "./lib/auth";
import { useTheme } from "./hooks/useTheme";

function PrivateRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { isAuthed, isAdmin } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/me" replace />;
  return <>{children}</>;
}

export default function App() {
  useTheme();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<PublicDashboard />} />
        <Route path="/artists" element={<PublicArtists />} />
        <Route path="/artist/:name" element={<ArtistDetail scope="public" />} />
        <Route path="/albums" element={<PublicAlbums />} />
        <Route path="/album/:artist/:album" element={<AlbumDetail scope="public" />} />
        <Route path="/track/:artist/:track" element={<TrackDetail scope="public" />} />
        <Route path="/rewind" element={<PublicRewind />} />
        <Route path="/login" element={<Login />} />

        <Route path="/me" element={<PrivateRoute><MeDashboard /></PrivateRoute>} />
        <Route path="/me/artists" element={<PrivateRoute><MeArtists /></PrivateRoute>} />
        <Route path="/me/artist/:name" element={<PrivateRoute><ArtistDetail scope="me" /></PrivateRoute>} />
        <Route path="/me/albums" element={<PrivateRoute><MeAlbums /></PrivateRoute>} />
        <Route path="/me/album/:artist/:album" element={<PrivateRoute><AlbumDetail scope="me" /></PrivateRoute>} />
        <Route path="/me/track/:artist/:track" element={<PrivateRoute><TrackDetail scope="me" /></PrivateRoute>} />
        <Route path="/me/rewind" element={<PrivateRoute><MeRewind /></PrivateRoute>} />

        <Route path="/library" element={<PrivateRoute adminOnly><Library /></PrivateRoute>} />
        <Route path="/discover" element={<PrivateRoute adminOnly><Discover /></PrivateRoute>} />
        <Route path="/queue" element={<PrivateRoute adminOnly><Queue /></PrivateRoute>} />
        <Route path="/review" element={<PrivateRoute adminOnly><Review /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute adminOnly><Settings /></PrivateRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
