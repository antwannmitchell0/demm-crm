'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  GitFork,
  Terminal,
  LogOut,
  User as UserIcon,
  Sparkles,
  Tag,
  UserPlus,
  TrendingUp,
  FileBarChart,
} from 'lucide-react';
import { removeAuthToken, removeActiveUser, getActiveUser } from '../lib/api';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = getActiveUser();

  const handleLogout = () => {
    removeAuthToken();
    removeActiveUser();
    router.push('/');
  };

  const navItems = [
    { name: 'Executive Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Contacts', href: '/contacts', icon: Users },
    { name: 'Pipelines', href: '/pipelines', icon: GitFork },
    { name: 'Leads', href: '/marketing/leads', icon: UserPlus },
    { name: 'Marketing Dashboard', href: '/marketing/dashboard', icon: TrendingUp },
    { name: 'Reports', href: '/marketing/reports', icon: FileBarChart },
    { name: 'Offers & Settings', href: '/marketing/offers', icon: Tag },
    { name: 'Agent Console', href: '/agent', icon: Terminal },
  ];

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-950/70 backdrop-blur-md flex flex-col justify-between text-slate-100 min-h-screen">
      <div>
        {/* Brand Header */}
        <div className="p-6 border-b border-slate-850 flex items-center space-x-2">
          <div className="bg-gradient-to-tr from-cyan-400 to-blue-600 p-2 rounded-lg text-white">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
              DEMM CRM
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider">AI-FIRST PLATFORM</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500/10 to-indigo-500/10 border-l-2 border-cyan-500 text-cyan-400'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <Icon className={`w-5 h-5 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span className="font-medium text-sm">{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Profile & Logout */}
      <div className="p-4 border-t border-slate-900">
        {user && (
          <div className="flex items-center space-x-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-bold">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-xs font-semibold truncate">{user.firstName} {user.lastName}</p>
              <p className="text-[10px] text-slate-500 truncate capitalize font-mono">{user.role}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center space-x-3 px-4 py-3 text-slate-400 hover:bg-rose-950/20 hover:text-rose-400 rounded-xl transition-all duration-150"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium text-sm">Logout</span>
        </button>
      </div>
    </aside>
  );
}
