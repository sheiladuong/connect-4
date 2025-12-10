import React, { useState, useEffect, useRef } from "react";
import { register } from "../api/auth";
import { Link, useNavigate } from "react-router-dom";
import { API_URL } from "../config/api";

const RECAPTCHA_SITE_KEY = "6LdHqyYsAAAAABGQP20INCDpuDEowBa06KjOj-A9";

// extend window interface for grecaptcha
declare global {
  interface Window {
    grecaptcha: any;
    onRecaptchaLoad?: () => void;
  }
}

const Register: React.FC = () => {
  const navigate = useNavigate();
  const recaptchaRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [recaptchaReady, setRecaptchaReady] = useState(false);

  // fetch registration token
  useEffect(() => {
    const fetchToken = async () => {
      try {
        const response = await fetch(`${API_URL}/register-token`);
        const data = await response.json();
        setRegistrationToken(data.token);
        setLoading(false);
      } catch (err) {
        setError("Failed to load registration form. Please refresh the page.");
        setLoading(false);
      }
    };

    fetchToken();
  }, []);

  // load and render reCAPTCHA
  useEffect(() => {
    // load the reCAPTCHA script dynamically
    const loadRecaptchaScript = () => {
      // check if script already exists, then render
      if (document.querySelector('script[src*="recaptcha"]')) {
        renderRecaptcha();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit';
      script.async = true;
      script.defer = true;
      
      // set up callback for when script loads
      window.onRecaptchaLoad = () => {
        console.log('reCAPTCHA script loaded');
        renderRecaptcha();
      };

      script.onerror = () => {
        console.error('Failed to load reCAPTCHA script');
        setError('Failed to load reCAPTCHA. Please check your internet connection.');
      };

      document.head.appendChild(script);
    };

    const renderRecaptcha = () => {
      const attemptRender = () => {
        if (window.grecaptcha && window.grecaptcha.render && recaptchaRef.current) {
          if (widgetIdRef.current === null) {
            try {
              console.log('Rendering reCAPTCHA widget');
              widgetIdRef.current = window.grecaptcha.render(recaptchaRef.current, {
                'sitekey': RECAPTCHA_SITE_KEY,
                'theme': 'light',
                'callback': () => {
                  console.log('reCAPTCHA completed');
                },
                'expired-callback': () => {
                  console.log('reCAPTCHA expired');
                },
                'error-callback': () => {
                  console.log('reCAPTCHA error');
                  setError('reCAPTCHA error. Please refresh the page.');
                }
              });
              setRecaptchaReady(true);
              console.log('reCAPTCHA widget rendered successfully');
            } catch (err) {
              console.error("Error rendering reCAPTCHA:", err);
              setError('Failed to initialize reCAPTCHA. Please refresh the page.');
            }
          }
        } else {
          setTimeout(attemptRender, 100);
        }
      };

      attemptRender();
    };

    loadRecaptchaScript();

    return () => {
      if (widgetIdRef.current !== null && window.grecaptcha && window.grecaptcha.reset) {
        try {
          window.grecaptcha.reset(widgetIdRef.current);
        } catch (err) {
          console.error("Error resetting reCAPTCHA:", err);
        }
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    // check if token is loaded
    if (!registrationToken) {
      setError("Registration token not loaded. Please refresh the page.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    // get reCAPTCHA response
    let captchaToken = "";
    try {
      if (window.grecaptcha && widgetIdRef.current !== null) {
        captchaToken = window.grecaptcha.getResponse(widgetIdRef.current);
      }
    } catch (err) {
      console.error("Error getting reCAPTCHA response:", err);
    }

    if (!captchaToken) {
      setError("Please complete the reCAPTCHA verification");
      return;
    }

    try {
      await register(username, password, registrationToken, captchaToken);
      setMessage("Registration successful! Redirecting...");
      setTimeout(() => navigate("/login"), 1500);
    } catch (err: any) {
      console.error("Registration error:", err);
      setError(err.message);
      
      // reset reCAPTCHA on error
      if (widgetIdRef.current !== null && window.grecaptcha && window.grecaptcha.reset) {
        try {
          window.grecaptcha.reset(widgetIdRef.current);
        } catch (resetErr) {
          console.error("Error resetting reCAPTCHA:", resetErr);
        }
      }
      
      // if token expired, fetch a new one
      if (err.message.includes("token")) {
        try {
          const response = await fetch(`${API_URL}/register-token`);
          const data = await response.json();
          setRegistrationToken(data.token);
          setError("Token expired. Please try again.");
        } catch (fetchErr) {
          setError("Failed to refresh token. Please reload the page.");
        }
      }
    }
  };

  if (loading) {
    return (
      <div className="auth-container">
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <h2>Create an Account</h2>
      <form onSubmit={handleSubmit}>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}

        <input
          type="text"
          placeholder="Choose a username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Choose a password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />

        {/* google reCAPTCHA */}
        <div style={{ marginTop: "15px", marginBottom: "15px" }}>
          <div ref={recaptchaRef}></div>
          {!recaptchaReady && (
            <p style={{ fontSize: "14px", color: "#666" }}>
              Loading reCAPTCHA...
            </p>
          )}
        </div>

        <button type="submit" disabled={!recaptchaReady}>
          Register
        </button>
      </form>

      <p>
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </div>
  );
};

export default Register;