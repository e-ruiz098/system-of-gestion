import React, { createContext, useContext, useEffect, useState } from 'react';
import { useGetConfig } from '@workspace/api-client-react';

interface ThemeContextType {
  theme: string;
  setTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'default', setTheme: () => {} });

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState('default');
  const { data: config } = useGetConfig();

  useEffect(() => {
    if (config?.tema_color) {
      setTheme(config.tema_color);
    }
  }, [config]);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
