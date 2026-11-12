import {createRoot} from 'react-dom/client';
import {OwnerApp} from './App';
import {FeedbackProvider} from './Common';
import '../style.css';
import './style.css';
createRoot(document.getElementById('root')!).render(<FeedbackProvider><OwnerApp/></FeedbackProvider>);
