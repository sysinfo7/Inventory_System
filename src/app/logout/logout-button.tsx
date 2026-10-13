import { logoutAction } from './actions';

export function LogoutButton() {
  return <form action={logoutAction}><button type="submit" className="account-button">Sign out</button></form>;
}
