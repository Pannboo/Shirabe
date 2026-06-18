import { useEffect, useState } from "react";

export function applyTheme(theme: string): void {
  const cls = document.documentElement.classList;
  cls.remove("dark", "light");
  cls.add(theme === "light" ? "light" : "dark");
}

export function useTheme(): { theme: string; setTheme: (t: string) => void } {
  const [theme, setThemeState] = useState<string>(() => {
    return localStorage.getItem("shirabe.theme") ?? "dark";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    // Fetch the server-side theme once for fresh visitors.
    fetch("/api/public/theme")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.theme && !localStorage.getItem("shirabe.theme")) {
          setThemeState(data.theme);
        }
      })
      .catch(() => {/* ignore */});
  }, []);

  const setTheme = (t: string) => {
    localStorage.setItem("shirabe.theme", t);
    setThemeState(t);
  };

  return { theme, setTheme };
}
