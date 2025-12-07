export type AuthCallback<T> = (error: Error | null, result?: T) => void;

export type MessageCallback<T> = (error: Error | null, result?: T) => void;
