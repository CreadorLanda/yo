import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type RegistrationData = {
  countryCode: string;
  phoneNumber: string;
  email: string;
  otp: string;
  displayName: string;
  avatarUri: string | null;
  username: string;
  isDiscoverable: boolean;
  contactsGranted: boolean;
  notificationsGranted: boolean;
};

const initial: RegistrationData = {
  countryCode: '+244',
  phoneNumber: '',
  email: '',
  otp: '',
  displayName: '',
  avatarUri: null,
  username: '',
  isDiscoverable: true,
  contactsGranted: false,
  notificationsGranted: false,
};

type Ctx = {
  data: RegistrationData;
  set: <K extends keyof RegistrationData>(key: K, value: RegistrationData[K]) => void;
  reset: () => void;
};

const RegistrationContext = createContext<Ctx | null>(null);

export function RegistrationProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<RegistrationData>(initial);

  const value = useMemo<Ctx>(
    () => ({
      data,
      set: (key, value) => setData((d) => ({ ...d, [key]: value })),
      reset: () => setData(initial),
    }),
    [data],
  );

  return <RegistrationContext.Provider value={value}>{children}</RegistrationContext.Provider>;
}

export function useRegistration() {
  const ctx = useContext(RegistrationContext);
  if (!ctx) throw new Error('useRegistration must be used inside <RegistrationProvider>');
  return ctx;
}
