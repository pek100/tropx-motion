export interface ApiClient {
    get<T>(url: string): Promise<T>;
    post<T>(url: string, data: any): Promise<T>;
    put<T>(url: string, data: any): Promise<T>;
    delete<T>(url: string): Promise<T>;
}

class DefaultApiClient implements ApiClient {
    async get<T>(url: string): Promise<T> {
        const response = await fetch(url);
        return response.json();
    }

    async post<T>(url: string, data: any): Promise<T> {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return response.json();
    }

    async put<T>(url: string, data: any): Promise<T> {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return response.json();
    }

    async delete<T>(url: string): Promise<T> {
        const response = await fetch(url, { method: 'DELETE' });
        return response.json();
    }
}

export const apiClient = new DefaultApiClient();