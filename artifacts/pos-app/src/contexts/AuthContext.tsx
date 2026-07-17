import React, { createContext, useContext } from 'react';
import { useGetMe, AuthUser, useGetConfig } from '@workspace/api-client-react';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isConfigured: false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    data: config,
    isLoading: isConfigLoading,
    error: configError,
  } = useGetConfig({
    query: { queryKey: ['/api/config'], retry: false, refetchOnWindowFocus: false },
  });

  // 404 on /api/config means the system has never been set up
  const isConfigured = !configError && !!config;

  const {
    data: user,
    isLoading: isUserLoading,
  } = useGetMe({
    query: {
      queryKey: ['/api/auth/me'],
      retry: false,
      refetchOnWindowFocus: false,
      enabled: isConfigured,
    },
  });

  const isLoading = isConfigLoading || (isConfigured && isUserLoading);

  return (
    <AuthContext.Provider value={{
      user: user ?? null,
      isLoading,
      isConfigured,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
