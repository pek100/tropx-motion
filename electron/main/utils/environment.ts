import { app } from 'electron';

export const isDev = !app.isPackaged;

export const getAppPath = () => app.getAppPath();
