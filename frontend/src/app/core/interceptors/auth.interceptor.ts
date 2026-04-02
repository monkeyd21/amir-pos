import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('accessToken');
  const branchData = localStorage.getItem('currentBranch');

  let headers = req.headers;

  if (token) {
    headers = headers.set('Authorization', `Bearer ${token}`);
  }

  if (branchData) {
    try {
      const branch = JSON.parse(branchData);
      headers = headers.set('X-Branch-Id', branch.id);
    } catch {
      // ignore invalid branch data
    }
  }

  return next(req.clone({ headers }));
};
