'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import { api, getAuthToken } from '../../lib/api';
import { 
  Search, 
  Plus, 
  Sparkles, 
  Mail, 
  Phone, 
  Tag, 
  Briefcase,
  User,
  Info,
  ChevronRight
} from 'lucide-react';

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // New Contact Fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [emails, setEmails] = useState('');
  const [phones, setPhones] = useState('');
  const [status, setStatus] = useState('LEAD');
  const [tags, setTags] = useState('');

  const fetchContacts = async () => {
    try {
      const list = await api.getContacts();
      setContacts(list);
      if (list.length > 0 && !selectedContact) {
        // Fetch detail of the first contact
        const details = await api.getContact(list[0].id);
        setSelectedContact(details);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    fetchContacts();
  }, [router]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const list = await api.searchContacts(searchQuery);
      setContacts(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectContact = async (id: string) => {
    try {
      const details = await api.getContact(id);
      setSelectedContact(details);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const newContact = await api.createContact({
        firstName,
        lastName,
        emails: emails ? [emails] : [],
        phones: phones ? [phones] : [],
        status,
        tags: tags ? tags.split(',').map(t => t.trim()) : [],
      });
      // Refresh
      setFirstName('');
      setLastName('');
      setEmails('');
      setPhones('');
      setTags('');
      setShowAddForm(false);
      await fetchContacts();
      handleSelectContact(newContact.id);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Main Contacts Area */}
        <div className="flex-1 p-8 border-r border-slate-900 overflow-y-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight">Contacts</h2>
              <p className="text-sm text-slate-400">Total contacts: {contacts.length}</p>
            </div>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl font-semibold text-xs hover:from-cyan-400 hover:to-indigo-500 transition flex items-center space-x-2 text-white"
            >
              <Plus className="w-4 h-4" />
              <span>Add Contact</span>
            </button>
          </div>

          {/* Add Contact Form (Conditional) */}
          {showAddForm && (
            <form onSubmit={handleCreateContact} className="p-6 bg-slate-950/70 border border-slate-900 rounded-2xl mb-8 space-y-4">
              <h3 className="text-sm font-bold tracking-wide uppercase text-slate-400">New Contact Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  required
                  placeholder="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus:outline-none"
                />
                <input
                  type="text"
                  required
                  placeholder="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="email"
                  placeholder="Email"
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Phone"
                  value={phones}
                  onChange={(e) => setPhones(e.target.value)}
                  className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus:outline-none text-slate-400"
                >
                  <option value="LEAD">Lead</option>
                  <option value="CONTACTED">Contacted</option>
                  <option value="PROPOSAL">Proposal</option>
                  <option value="CUSTOMER">Customer</option>
                </select>
                <input
                  type="text"
                  placeholder="Tags (comma separated)"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 rounded-xl font-bold text-xs hover:bg-cyan-500 text-white"
                >
                  Save Record
                </button>
              </div>
            </form>
          )}

          {/* Search bar */}
          <form onSubmit={handleSearch} className="mb-6 flex space-x-2">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Search by name, email, phone, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-950/60 border border-slate-900 rounded-xl focus:border-cyan-500/50 focus:outline-none text-sm"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-sm font-semibold text-slate-300"
            >
              Search
            </button>
          </form>

          {/* Contacts Table/List */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-3xl overflow-hidden">
            {contacts.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">No contacts found in workspace.</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-900 text-[10px] uppercase font-mono tracking-wider text-slate-500 bg-slate-950/60">
                    <th className="px-6 py-4">Name</th>
                    <th className="px-6 py-4">Primary Contact</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Tags</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/60">
                  {contacts.map((contact) => (
                    <tr
                      key={contact.id}
                      onClick={() => handleSelectContact(contact.id)}
                      className={`hover:bg-slate-900/40 cursor-pointer transition-colors duration-150 ${
                        selectedContact?.id === contact.id ? 'bg-indigo-950/15 border-l-2 border-indigo-500' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300">
                            {contact.firstName[0]}{contact.lastName[0]}
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{contact.firstName} {contact.lastName}</div>
                            <div className="text-[10px] text-slate-500">{contact.company?.name || 'No Company'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        <div>{contact.emails[0] || '—'}</div>
                        <div className="text-[10px] text-slate-500">{contact.phones[0] || '—'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          contact.status === 'LEAD' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          contact.status === 'CONTACTED' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                          contact.status === 'PROPOSAL' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {contact.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1 flex-wrap">
                          {contact.tags.map((tag: string) => (
                            <span key={tag} className="px-2 py-0.5 bg-slate-900 border border-slate-850 text-slate-400 rounded-md text-[9px]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <ChevronRight className="w-4 h-4 text-slate-600 inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Sidebar Details / AI Recommendations Panel */}
        {selectedContact && (
          <div className="w-full md:w-96 bg-slate-950/70 backdrop-blur-md p-6 overflow-y-auto flex flex-col justify-between">
            <div>
              {/* Contact summary header */}
              <div className="flex items-center space-x-3 mb-6 pb-6 border-b border-slate-900">
                <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-cyan-400 to-indigo-600 flex items-center justify-center font-bold text-base text-white">
                  {selectedContact.firstName[0]}{selectedContact.lastName[0]}
                </div>
                <div>
                  <h3 className="font-extrabold text-lg">{selectedContact.firstName} {selectedContact.lastName}</h3>
                  <p className="text-xs text-slate-400">Lead Score: <span className="text-cyan-400 font-bold font-mono">{selectedContact.leadScore}</span></p>
                </div>
              </div>

              {/* Basic Details */}
              <div className="space-y-4 mb-6">
                <h4 className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase flex items-center space-x-1">
                  <Info className="w-3.5 h-3.5" />
                  <span>Bio Details</span>
                </h4>
                {selectedContact.emails.length > 0 && (
                  <div className="flex items-center space-x-2.5 text-xs text-slate-300">
                    <Mail className="w-4 h-4 text-slate-500" />
                    <span>{selectedContact.emails[0]}</span>
                  </div>
                )}
                {selectedContact.phones.length > 0 && (
                  <div className="flex items-center space-x-2.5 text-xs text-slate-300">
                    <Phone className="w-4 h-4 text-slate-500" />
                    <span>{selectedContact.phones[0]}</span>
                  </div>
                )}
                {selectedContact.company && (
                  <div className="flex items-center space-x-2.5 text-xs text-slate-300">
                    <Briefcase className="w-4 h-4 text-slate-500" />
                    <span>{selectedContact.company.name} ({selectedContact.company.industry})</span>
                  </div>
                )}
                {selectedContact.tags.length > 0 && (
                  <div className="flex items-start space-x-2.5 text-xs text-slate-300">
                    <Tag className="w-4 h-4 text-slate-500 mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                      {selectedContact.tags.map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 bg-slate-900 border border-slate-800 text-slate-400 rounded-md text-[9px]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* AI-First Summary & Explainability Recommendation */}
              <div className="p-4 bg-gradient-to-r from-cyan-950/15 to-indigo-950/15 border border-cyan-500/10 rounded-2xl mb-6">
                <h4 className="text-xs font-bold text-slate-200 mb-2 flex items-center space-x-1.5">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <span>AI Twin Copilot Recommendations</span>
                </h4>
                <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
                  <div>
                    <p className="font-semibold text-cyan-400">Context Summary:</p>
                    <p className="text-slate-400 mt-0.5">
                      {selectedContact.aiSummary || 'Lead acquired from online marketing request. Needs initial qualification.'}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-indigo-400">Next Best Action:</p>
                    <p className="text-slate-400 mt-0.5">
                      {selectedContact.aiRecommends?.action || 'Offer standard photobooth packages. Suggested wedding pricing adjustment: $850.'}
                    </p>
                  </div>
                  <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 text-[10px]">
                    <p className="font-bold text-slate-400 uppercase tracking-wider font-mono">Why:</p>
                    <p className="text-slate-500 mt-0.5">
                      {selectedContact.aiRecommends?.reason || '91% close rate on wedding proposals recently. Average local market value sits at $900. Upsell probability is high.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Activities Timeline */}
            <div className="border-t border-slate-900 pt-6">
              <h4 className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-3">Timeline History</h4>
              <div className="space-y-3 max-h-32 overflow-y-auto pr-1">
                {selectedContact.activities && selectedContact.activities.length > 0 ? (
                  selectedContact.activities.map((act: any) => (
                    <div key={act.id} className="text-xs flex items-start space-x-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-1.5"></div>
                      <div>
                        <p className="text-slate-300 font-semibold">{act.description}</p>
                        <p className="text-[9px] text-slate-500">{new Date(act.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-600">No activity recorded for this contact.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
