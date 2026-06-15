export type LoginResponse = {
  token: string;
  user: {
    id: number;
    nickname: string;
    fullName: string;
    role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
    storeName: string;
  };
};
