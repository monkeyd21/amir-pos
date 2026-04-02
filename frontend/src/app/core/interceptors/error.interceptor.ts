import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const notification = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let message = 'An unexpected error occurred';

      switch (error.status) {
        case 0:
          message = 'Unable to connect to the server. Please check your connection.';
          break;
        case 400:
          message = error.error?.message || 'Bad request';
          break;
        case 401:
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('currentUser');
          router.navigate(['/login']);
          message = 'Session expired. Please log in again.';
          break;
        case 403:
          message = 'You do not have permission to perform this action.';
          break;
        case 404:
          message = error.error?.message || 'Resource not found';
          break;
        case 409:
          message = error.error?.message || 'Conflict: resource already exists';
          break;
        case 422:
          message = error.error?.message || 'Validation error';
          break;
        case 500:
          message = 'Internal server error. Please try again later.';
          break;
        default:
          message = error.error?.message || message;
      }

      notification.error(message);
      return throwError(() => error);
    })
  );
};
