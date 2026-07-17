import React, { createContext, useContext, useEffect, useState } from 'react';
import { useGetMe, AuthUser } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { useGetConfig } from '@workspace/api-client-react';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, isLoading: true });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [, setLocation] = useLocation();
  const { data: config, isLoading: isConfigLoading, error: configError } = useGetConfig({
    query: { queryKey: ['/api/config'], retry: false, refetchOnWindowFocus: false },
  });
  
  const { data: user, isLoading: isUserLoading, error: userError } = useGetMe({
    query: { queryKey: ['/api/auth/me'], retry: false, refetchOnWindowFocus: false, enabled: !!config },
  });

  useEffect(() => {
    if (!isConfigLoading && !config) {
      setLocation('/setup');
    } else if (!isConfigLoading && config && !isUserLoading && !user) {
      if (window.location.pathname !== '/login' && window.location.pathname !== '/setup') {
        setLocation('/login');
      }
    }
  }, [config, isConfigLoading, user, isUserLoading, setLocation]);

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading: isConfigLoading || isUserLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
