import { Link, Route, Routes } from "react-router-dom";
import { ArrowRight, FileText, Search, Calculator, ShieldCheck, Menu, X } from "lucide-react";
import { useState } from "react";

const navItems = [
  ["Process BOE", "/process-boe"],
  ["HSN Search", "/hsn-search"],
  ["Duty Calculator", "/duty-calculator"],
];

function Layout({ children }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="site-shell">
      <header className="topbar">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">BOE</span>
          <span>
            <strong>BOE FLOW</strong>
            <small>Customs Automation</small>
          </span>
        </Link>

        <nav className={open ? "nav open" : "nav"}>
          {navItems.map(([label, href]) => (
            <Link key={href} to={href} onClick={() => setOpen(false)}>{label}</Link>
          ))}
          <Link className="nav-cta" to="/process-boe" onClick={() => setOpen(false)}>
            Start Processing <ArrowRight size={16} />
          </Link>
        </nav>

        <button className="menu-button" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </header>

      <main>{children}</main>

      <footer className="footer">
        <div>
          <strong>BOE FLOW</strong>
          <span>Customs BOE Processing & Automated E-Way Bill Reconciliation</span>
        </div>
        <div className="footer-links">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/contact">Contact</Link>
        </div>
        <div className="footer-bottom">© 2026 BOE FLOW. All rights reserved.</div>
      </footer>
    </div>
  );
}

function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><ShieldCheck size={15} /> Customs workflow, simplified</div>
          <h1>Bill of Entry processing without the paperwork headache.</h1>
          <p>Process BOE documents, review HSN and customs duties, and prepare E-Way Bill data from one clean workspace.</p>
          <div className="hero-actions">
            <Link className="button primary" to="/process-boe">Process a BOE <ArrowRight size={18} /></Link>
            <Link className="button secondary" to="/hsn-search">Search HSN</Link>
          </div>
        </div>

        <div className="hero-panel">
          <div className="panel-label">BOE FLOW</div>
          <div className="flow-row"><FileText /><span>Upload Bill of Entry</span><b>01</b></div>
          <div className="flow-row"><Search /><span>Extract & review</span><b>02</b></div>
          <div className="flow-row"><Calculator /><span>Calculate duty</span><b>03</b></div>
          <div className="flow-row"><ShieldCheck /><span>Prepare E-Way data</span><b>04</b></div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <span className="eyebrow">One workspace</span>
          <h2>Everything you need for import documentation.</h2>
        </div>
        <div className="feature-grid">
          <Feature icon={<FileText />} title="BOE Processing" text="Upload a Bill of Entry and review the extracted document data in a structured format." />
          <Feature icon={<Search />} title="HSN Search" text="Search tariff headings and review applicable customs information." />
          <Feature icon={<Calculator />} title="Duty Review" text="Review assessable value, BCD, SWS, IGST and total payable duty." />
        </div>
      </section>
    </>
  );
}

function Feature({ icon, title, text }) {
  return <article className="feature-card"><div className="feature-icon">{icon}</div><h3>{title}</h3><p>{text}</p><Link to="/process-boe">Explore <ArrowRight size={15} /></Link></article>;
}

function ProcessBOE() {
  return <Page title="Process Bill of Entry" subtitle="Upload your BOE PDF and review the extracted customs information."><div className="upload-card"><FileText size={36} /><h2>Upload your BOE</h2><p>PDF files supported. Processing API will be connected in the next migration step.</p><label className="upload-button">Choose PDF<input type="file" accept=".pdf,application/pdf" /></label></div></Page>;
}

function HSN() { return <Page title="HSN Search" subtitle="Search Indian customs tariff information from a single interface."><div className="search-card"><input placeholder="Enter 4–8 digit HSN / CTH" /><button className="button primary">Search</button></div></Page>; }
function Duty() { return <Page title="Duty Calculator" subtitle="Review customs duty components including BCD, SWS and IGST."><div className="empty-state"><Calculator size={32} /><h2>Calculator coming next</h2><p>The calculation engine will be connected to the existing Python logic without changing its results.</p></div></Page>; }
function Page({ title, subtitle, children }) { return <section className="page"><div className="page-heading"><span className="eyebrow">BOE FLOW</span><h1>{title}</h1><p>{subtitle}</p></div>{children}</section>; }

function SimplePage({ title }) { return <Page title={title} subtitle="This page will be connected as the new website is completed." />; }

export default function App() {
  return <Layout><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/process-boe" element={<ProcessBOE />} />
    <Route path="/hsn-search" element={<HSN />} />
    <Route path="/duty-calculator" element={<Duty />} />
    <Route path="/contact" element={<SimplePage title="Contact Us" />} />
    <Route path="/terms" element={<SimplePage title="Terms & Conditions" />} />
    <Route path="/privacy" element={<SimplePage title="Privacy Policy" />} />
  </Routes></Layout>;
}
